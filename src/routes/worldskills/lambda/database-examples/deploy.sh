# Function ZIP · Node.js 22 / 24 · x86_64 / arm64 · handler index.handler
curl -fLO https://megakuul.ch/downloads/nodejs-databases-function.zip
aws lambda create-function --function-name db-demo --runtime nodejs24.x --architectures arm64 --handler index.handler --role arn:aws:iam::111122223333:role/lambda-execution --zip-file fileb://nodejs-databases-function.zip --timeout 30 --memory-size 512
aws lambda wait function-active-v2 --function-name db-demo
aws lambda invoke --function-name db-demo --cli-binary-format raw-in-base64-out --payload '{}' drivers.json

# Layer ZIP · existing function
curl -fLO https://megakuul.ch/downloads/nodejs-databases-layer.zip
LAYER=$(aws lambda publish-layer-version --layer-name nodejs-databases --zip-file fileb://nodejs-databases-layer.zip --compatible-runtimes nodejs22.x nodejs24.x --compatible-architectures x86_64 arm64 --query LayerVersionArn --output text)
aws lambda get-function-configuration --function-name my-function > function-current.json
jq --arg layer "$LAYER" '{FunctionName,RevisionId,Layers:([.Layers[]?.Arn]+[$layer])}' function-current.json > function-layers.json
aws lambda update-function-configuration --cli-input-json file://function-layers.json

# Function ZIP: /var/task/certs/rds.pem · Layer ZIP: /opt/certs/rds.pem
# Keyspaces: /var/task/certs/keyspaces.pem or /opt/certs/keyspaces.pem
# Private databases: Lambda VPC subnets + SG access to the database port.
