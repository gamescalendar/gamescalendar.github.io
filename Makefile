.PHONY: update
update:
	git fetch origin release
	git checkout origin/release -- events.json deleted.json
	node ./generate.js list.txt events.json deleted.json
