#!/bin/bash

for key in $(redis-cli KEYS '*' ); do

	count=$(redis-cli GET $key | wc -c)
	if [[ $count -le 4000 ]]; then
		echo " ($count) $key"
		redis-cli DEL $key
	fi
	
done