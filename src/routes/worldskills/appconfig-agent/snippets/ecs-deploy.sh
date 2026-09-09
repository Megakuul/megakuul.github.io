ECS_CLUSTER=my-cluster
ECS_SERVICE=my-service
APP_CONTAINER=app
TASK_ARN=$(aws ecs describe-services --cluster "$ECS_CLUSTER" --services "$ECS_SERVICE" --query 'services[0].taskDefinition' --output text)
aws ecs describe-task-definition --task-definition "$TASK_ARN" --query taskDefinition > ecs-current.json
jq -e --arg app "$APP_CONTAINER" '.networkMode == "awsvpc" and (.taskRoleArn | type == "string") and any(.containerDefinitions[]; .name == $app)' ecs-current.json
TASK_ROLE=$(jq -r .taskRoleArn ecs-current.json)
aws iam attach-role-policy --role-name "${TASK_ROLE##*/}" --policy-arn "$POLICY_ARN"

# Task CPU/memory must have room for the additional sidecar; app retries initial reads.
jq --arg image "$AGENT_IMAGE" --arg region "$AWS_REGION" --arg path "$CONFIG_PATH" --arg app "$APP_CONTAINER" '
  del(.taskDefinitionArn,.revision,.status,.requiresAttributes,.compatibilities,.registeredAt,.registeredBy,.deregisteredAt)
  | .containerDefinitions |= (map(select(.name != "appconfig-agent")) + [{
      name:"appconfig-agent", image:$image, essential:true, memoryReservation:64,
      environment:[
        {name:"SERVICE_REGION",value:$region},
        {name:"HTTP_HOST",value:"localhost"},
        {name:"HTTP_PORT",value:"2772"},
        {name:"PREFETCH_LIST",value:$path},
        {name:"POLL_INTERVAL",value:"45s"},
        {name:"REQUEST_TIMEOUT",value:"3s"},
        {name:"LOG_LEVEL",value:"warn"}
      ]
    }])
  | (.containerDefinitions[] | select(.name == $app)) |= (
      .environment = ((.environment // [] | map(select(.name != "APPCONFIG_PATH"))) + [{name:"APPCONFIG_PATH",value:$path}])
      | .dependsOn = ((.dependsOn // [] | map(select(.containerName != "appconfig-agent"))) + [{containerName:"appconfig-agent",condition:"START"}])
    )
' ecs-current.json > ecs-agent.json
NEW_TASK_ARN=$(aws ecs register-task-definition --cli-input-json file://ecs-agent.json --query taskDefinition.taskDefinitionArn --output text)
aws ecs update-service --cluster "$ECS_CLUSTER" --service "$ECS_SERVICE" --task-definition "$NEW_TASK_ARN"
aws ecs wait services-stable --cluster "$ECS_CLUSTER" --services "$ECS_SERVICE"
