// @ts-nocheck
/** Resolve bootstrap settings once, leaving only names, locations and tags as inputs. */
export function bootstrapTemplate(template) {
  const fixedNames = [
    'RetentionDays',
    'RateLimit',
    'ManagedRuleMode',
    'IncludeGlobalIAM',
    'ErrorRatePercent',
    'MinInvocations',
    'NotificationTopicArn',
  ];
  const fixed = Object.fromEntries(
    Object.entries(template.Parameters)
      .filter(([key]) => fixedNames.includes(key))
      .map(([key, value]) => [key, value.Default]),
  );
  const conditions = {};
  function resolve(value) {
    if (Array.isArray(value)) return value.map(resolve);
    if (!value || typeof value !== 'object') return value;
    if (value.Ref in fixed) return fixed[value.Ref];
    if (value['Fn::Equals']) {
      const parts = value['Fn::Equals'].map(resolve);
      if (parts.every(v => typeof v !== 'object')) return parts[0] === parts[1];
    }
    if (value['Fn::Not']) {
      const result = resolve(value['Fn::Not'][0]);
      if (typeof result === 'boolean') return !result;
    }
    if (value['Fn::If'] && typeof conditions[value['Fn::If'][0]] === 'boolean')
      return resolve(value['Fn::If'][conditions[value['Fn::If'][0]] ? 1 : 2]);
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([key, v]) => [key, resolve(v)]),
    );
  }
  for (const [key, value] of Object.entries(template.Conditions ?? {}))
    conditions[key] = resolve(value);
  const result = resolve(template);
  delete result.Description;
  for (const key of fixedNames) delete result.Parameters[key];
  for (const p of Object.values(result.Parameters))
    for (const key of [
      'AllowedValues',
      'AllowedPattern',
      'ConstraintDescription',
      'MinLength',
      'MaxLength',
      'MinValue',
      'MaxValue',
      'Description',
    ])
      delete p[key];
  for (const [key, value] of Object.entries(conditions))
    if (typeof value === 'boolean') delete result.Conditions[key];
  if (result.Conditions && !Object.keys(result.Conditions).length) delete result.Conditions;
  for (const collection of [result.Resources, result.Outputs ?? {}]) {
    for (const [key, value] of Object.entries(collection)) {
      if (value.Condition && conditions[value.Condition] === false) delete collection[key];
      else if (value.Condition && conditions[value.Condition] === true) delete value.Condition;
    }
  }
  for (const output of Object.values(result.Outputs ?? {})) delete output.Description;
  for (const resource of Object.values(result.Resources)) {
    if (resource.Type === 'AWS::Lambda::Function' && resource.Properties.Environment) {
      for (const [key, value] of Object.entries(resource.Properties.Environment.Variables))
        if (typeof value === 'number')
          resource.Properties.Environment.Variables[key] = String(value);
    }
  }
  return result;
}
