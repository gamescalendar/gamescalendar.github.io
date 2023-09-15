.PHONY: update
update:
	git fetch origin release
	git checkout origin/release -- events.json
	node ./generate.js list.txt
