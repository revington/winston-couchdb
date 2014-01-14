BIN= ./node_modules/.bin
test: create-db test-unit destroy-db

test-unit:
	@NODE_ENV=test $(BIN)/vows  test/*-test.js --spec

create-db:
	@curl -X PUT 127.0.0.1:5984/winston-couch-test

destroy-db:
	@curl -X DELETE 127.0.0.1:5984/winston-couch-test
