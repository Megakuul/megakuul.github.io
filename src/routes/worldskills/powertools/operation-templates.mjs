import { shell, identity } from './native-commands.mjs';
export function securityCommand() {
  return shell(
    [
      ...identity(),
      `tags=$(jq -cn '{(env.TAG_KEY):env.TAG_VALUE}')`,
      'detector=$(aws guardduty list-detectors --query "DetectorIds[0]" --output text)',
      'analyzers=$(aws accessanalyzer list-analyzers --output json)',
      `jq -e --arg name "$NAME" 'all(.analyzers[]; .name != $name or .type == "ACCOUNT") and all(.analyzers[] | select(.type=="ACCOUNT"); .status=="ACTIVE" or .status=="CREATING")' <<<"$analyzers" >/dev/null`,
      'analyzer=$(jq -r \'.analyzers[] | select(.type=="ACCOUNT") | .arn\' <<<"$analyzers")',
      `if [ "$detector" = None ]; then detector=$(aws guardduty create-detector --enable --finding-publishing-frequency FIFTEEN_MINUTES --tags "$tags" --query DetectorId --output text); else aws guardduty update-detector --detector-id "$detector" --enable --finding-publishing-frequency FIFTEEN_MINUTES && aws guardduty tag-resource --resource-arn "arn:$PARTITION:guardduty:$REGION:$ACCOUNT_ID:detector/$detector" --tags "$tags"; fi`,
      `if [ -n "$analyzer" ]; then aws accessanalyzer tag-resource --resource-arn "$analyzer" --tags "$tags"; else analyzer=$(aws accessanalyzer create-analyzer --analyzer-name "$NAME" --type ACCOUNT --tags "$tags" --query arn --output text); fi`,
      `printf 'Detector: %s\\nAnalyzer: %s\\n' "$detector" "$analyzer"`,
    ],
    ['NAME'],
  );
}
export function eksCommand() {
  return shell(
    [
      ...identity(),
      `tags=$(jq -cn '{(env.TAG_KEY):env.TAG_VALUE}')`,
      'group="/aws/eks/$CLUSTER_NAME/cluster"',
      `if err=$(aws logs create-log-group --log-group-name "$group" --deletion-protection-enabled --tags "$tags" 2>&1); then :; elif [[ "$err" == *"(ResourceAlreadyExistsException)"* ]]; then aws logs tag-resource --resource-arn "arn:$PARTITION:logs:$REGION:$ACCOUNT_ID:log-group:$group" --tags "$tags" && aws logs put-log-group-deletion-protection --log-group-identifier "$group" --deletion-protection-enabled; else printf '%s\\n' "$err" >&2; exit 1; fi`,
      'aws logs put-retention-policy --log-group-name "$group" --retention-in-days 30',
      `aws eks update-cluster-config --name "$CLUSTER_NAME" --logging '{"clusterLogging":[{"types":["api","audit","authenticator","controllerManager","scheduler"],"enabled":true}]}' --query update.id --output text`,
    ],
    ['CLUSTER_NAME'],
  );
}
