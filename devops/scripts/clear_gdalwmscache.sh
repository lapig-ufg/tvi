#!/bin/bash
find /var/tmp/gdalwmscache/ -name '*' -amin +5 -exec rm -vR {} \;