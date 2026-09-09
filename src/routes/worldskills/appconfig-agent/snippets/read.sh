curl --fail-with-body --silent --show-error --max-time 5 --retry 5 --retry-all-errors --retry-delay 1 "http://127.0.0.1:2772$APPCONFIG_PATH"
curl --fail-with-body --silent --show-error --max-time 5 "http://127.0.0.1:2772$APPCONFIG_PATH?flag=my_flag"
