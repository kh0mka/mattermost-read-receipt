.PHONY: build dist clean test

PLUGIN_ID ?= com.mst.read-receipt
GOOS ?= linux
GOARCH ?= amd64

test:
	go test ./server

build:
	mkdir -p server/dist
	GOOS=$(GOOS) GOARCH=$(GOARCH) go build -o server/dist/plugin-$(GOOS)-$(GOARCH) ./server

dist: build
	rm -rf dist
	mkdir -p dist/$(PLUGIN_ID)/server/dist dist/$(PLUGIN_ID)/webapp/dist
	cp plugin.json dist/$(PLUGIN_ID)/
	cp server/dist/plugin-$(GOOS)-$(GOARCH) dist/$(PLUGIN_ID)/server/dist/plugin-$(GOOS)-$(GOARCH)
	test -f webapp/dist/main.js || (echo "missing webapp/dist/main.js" >&2; exit 1)
	cp webapp/dist/main.js dist/$(PLUGIN_ID)/webapp/dist/main.js
	cd dist && tar -czvf $(PLUGIN_ID).tar.gz $(PLUGIN_ID)

clean:
	rm -rf server/dist dist webapp/dist webapp/node_modules
