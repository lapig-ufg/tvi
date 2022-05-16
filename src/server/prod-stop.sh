#!/bin/bash
kill $(pgrep -f "node --no-deprecation /APP/tvi/src/server/app-tvi-cluster.js")
