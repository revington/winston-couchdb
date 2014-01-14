/* jshint camelcase: false */
'use strict';
/*
 * Couchdb.js: Transport for logging to Couchdb
 *
 * (C) 2011 Max Ogden
 * MIT LICENSE
 *
 */

var winston = require('winston'),
    common = require('winston/lib/winston/common'),
    util = require('util'),
    cycle = require('cycle'),
    Stream = require('stream').Stream;

//
// ### function Couchdb (options)
// #### @options {Object} Options for this instance.
// Constructor function for the Console transport object responsible
// for making arbitrary HTTP requests whenever log messages and metadata
// are received.
//
var Couchdb = exports.Couchdb = function (options) {
  options = options || {};

  winston.Transport.call(this, options);

  this.name   = 'couchdb';
  this.db     = options.db     || options.database || 'winston';
  this.host   = options.host   || 'localhost';
  this.port   = options.port   || 5984;
  this.auth   = options.auth;
  this.secure = /^https:/i.test(this.host) || !!(options.ssl || options.secure);

  // Legacy
  if (options.user) {
    this.auth = {
      username: options.user,
      password: options.pass || ''
    };
  }
};

//
// Inherit from `winston.Transport`.
//
util.inherits(Couchdb, winston.Transport);

//
// Expose the name of this Transport on the prototype
//
Couchdb.prototype.name = 'couchdb';

//
// Define a getter so that `winston.transports.Couchdb`
// is available and thus backwards compatible.
//
winston.transports.Couchdb = Couchdb;

//
// ### function log (level, msg, [meta], callback)
// #### @level {string} Level at which to log the message.
// #### @msg {string} Message to log
// #### @meta {Object} **Optional** Additional metadata to attach
// #### @callback {function} Continuation to respond to when complete.
// Core logging method exposed to Winston. Metadata is optional.
//
Couchdb.prototype.log = function (level, msg, meta, callback) {
  if (this.silent) {
    return callback && callback(null, true);
  }

  var self = this;

  //
  // Write logging event to the outgoing request body
  //
  var params = common.clone(cycle.decycle(meta)) || {};
  // RFC3339/ISO8601 format instead of common.timestamp()
  params.timestamp = new Date();
  params.message = msg;
  params.level = level;

  // Perform logging request
  this.client.save({
    resource: 'log',
    params: params
  }, function (err) {
    //
    // Propagate the `error` back up to the `Logger` that this
    // instance belongs to.
    //
    if (err) {
      self.emit('error', err);
      if (callback) callback(err, false);
      return;
    }

    // TODO: emit 'logged' correctly,
    // keep track of pending logs.
    self.emit('logged');

    if (callback) callback(null, true);
  });
};

//
// ### function _ensureView (callback)
// #### @callback {function} Continuation to respond to when complete.
// Ensure the `byTimestamp` view. This is necessary
// for the `from` and `until` options.
//
Couchdb.prototype._ensureView = function (callback) {
  var self = this;

  callback = callback || function(){};

  if (this._ensuredView) return callback();

  this._ensuredView = true;

  function checkDB() {
    self.client.exists(function (err, exists) {
      if (err) return callback(err);
      return !exists
        ? self.client.create(checkView)
        : checkView();
    });
  }

  function checkView(err) {
    if (err) return callback(err);
    self.client.get('_design/Logs', function (err, result) {
      return !err && result
        ? callback()
        : save();
    });
  }

  function save(err) {
    if (err) return callback(err);
    // If we were to ignore `from` and `until`,
    // this wouldn't be necessary. We could just
    // use .all() or _all_docs.
    self.client.save('_design/Logs', {
      views: {
        byTimestamp: {
          map: function (doc) {
            if (doc.resource === 'log') {
              /* global emit */
              emit(doc.params.timestamp, doc);
            }
          }
        }
      }
    }, callback);
  }

  checkDB();
};

//
// ### function _ensureClient ()
// Ensure the existence of a crade client.
//
Couchdb.prototype._ensureClient = function () {
  if (this._client) return this._client;
  var Cradle = require('cradle').Connection;
  this._client = new Cradle(this.host, this.port, {
    secure: this.secure,
    auth: this.auth
  }).database(this.db);
  this._ensureView();
  return this._client;
};

Couchdb.prototype.__defineGetter__('client', function () {
  return this._ensureClient();
});

//
// ### function query (options, callback)
// #### @options {Object} Loggly-like query options for this instance.
// #### @callback {function} Continuation to respond to when complete.
// Query the transport. Options object is optional.
//
Couchdb.prototype.query = function (options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  if(!Number.isNaN){
  }

  var self = this,
      query = {};

  options = this.normalizeQuery(options);

  if (!this._ensuredView) {
    return this._ensureView(function (err) {
      if (err) return callback(err);
      self.query(options, callback);
    });
  }

  if (options.rows) query.limit = options.rows;
  if (options.start) query.skip = options.start;
  if (options.order === 'desc') {
    query.descending = true;
    if (options.from) query.endkey = options.from.toISOString();
    if (options.until) query.startkey = options.until.toISOString();
  } else {
    if (options.from) query.startkey = options.from.toISOString();
    if (options.until) query.endkey = options.until.toISOString();
  }

  this.client.view('Logs/byTimestamp', query, function (err, docs) {
    if (err) return callback(err);

    docs = docs.map(function (doc) {
      doc = doc.params;
      return doc;
    });

    if (options.fields) {
      docs.forEach(function (doc) {
        Object.keys(doc).forEach(function (key) {
          if (!~options.fields.indexOf(key)) {
            delete doc[key];
          }
        });
      });
    }

    callback(null, docs);
  });
};

//
// ### function stream (options)
// #### @options {Object} Stream options for this instance.
// Returns a log stream for this transport. Options object is optional.
//
Couchdb.prototype.stream = function (options) {
  var self = this,
      stream = new Stream(),
      feed;

  options = options || {},

  stream.destroy = function () {
    this.destroyed = true;
    try {
      feed.stop();
    } catch (e) {
      ;
    }
  };

  this.client.info(function (err, info) {
    var since = (options.start === -1 || !options.start) ? null : info.update_seq;
    if (err) return stream.emit('error', err);
    
    feed = self.client.changes({
      include_docs: true,
      feed: 'continuous',
      style: 'main_only',
      descending: false,
      since: since
    });

    feed.on('change', function (change) {
      if (!change.deleted && change.doc && change.doc.params) {
        stream.emit('log', change.doc.params);
      }
    });

    feed.on('error', function (err) {
      stream.emit('error', err);
    });
  });

  return stream;
};
