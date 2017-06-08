#!/bin/bash

for key in $(redis-cli KEYS '*' ); do

	result=$(redis-cli GET $key | grep 'QW4gaW50ZXJuYWwgc2VydmVyIGVycm9yIGhhcyBvY2N1cnJlZCA*')
	if [ ! -z "$result" ]; then
		redis-cli DEL $key
	fi

	result=$(redis-cli GET $key | grep 'VXNlciBtZW1vcnkgbGltaXQgZXhjZWVkZWQu')
	if [ ! -z "$result" ]; then
		redis-cli DEL $key
	fi
	
done