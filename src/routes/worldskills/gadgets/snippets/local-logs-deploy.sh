# Use an existing Node.js Lambda. No execution-role permissions are needed for the buffer.
# This deployment still requires your normal Lambda management permissions.
zip local-logs-gadget.zip local-logs-index.mjs local-logs.mjs

aws lambda update-function-code \
  --function-name local-logs-gadget \
  --zip-file fileb://local-logs-gadget.zip

aws lambda wait function-updated --function-name local-logs-gadget

aws lambda update-function-configuration \
  --function-name local-logs-gadget \
  --handler local-logs-index.handler \
  --timeout 30 \
  --environment 'Variables={DIAGNOSTIC_USER=diagnostic,DIAGNOSTIC_PASSWORD=change-this-now}'

aws lambda create-function-url-config \
  --function-name local-logs-gadget \
  --auth-type NONE \
  --invoke-mode BUFFERED

aws lambda add-permission \
  --function-name local-logs-gadget \
  --statement-id LocalLogsInvokeURL \
  --action lambda:InvokeFunctionUrl \
  --principal '*' \
  --function-url-auth-type NONE

aws lambda add-permission \
  --function-name local-logs-gadget \
  --statement-id LocalLogsInvokeFunction \
  --action lambda:InvokeFunction \
  --principal '*' \
  --invoked-via-function-url

# Invoke the function with your events, then open its Function URL at /web.
