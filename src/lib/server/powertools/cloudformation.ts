import { Document, Pair, YAMLMap, YAMLSeq, type Node } from 'yaml';

export function cloudFormationYaml(template: object) {
  const document = new Document(undefined, { version: '1.1' });
  const tags: Record<string, string> = {
    Ref: '!Ref',
    'Fn::Sub': '!Sub',
    'Fn::GetAtt': '!GetAtt',
    'Fn::If': '!If',
    'Fn::Equals': '!Equals',
    'Fn::Not': '!Not',
    'Fn::Join': '!Join',
  };
  function node(value: any): Node {
    if (Array.isArray(value)) {
      const sequence = new YAMLSeq();
      sequence.items = value.map(node);
      return sequence;
    }
    if (value && typeof value === 'object') {
      const entries = Object.entries(value).filter(([, v]) => v !== undefined);
      if (entries.length === 1 && entries[0][0] in tags) {
        const [key, data] = entries[0];
        const intrinsic = node(key === 'Fn::GetAtt' && Array.isArray(data) ? data.join('.') : data);
        intrinsic.tag = tags[key];
        return intrinsic;
      }
      const mapping = new YAMLMap();
      mapping.items = entries.map(([key, v]) => new Pair(document.createNode(key), node(v)));
      return mapping;
    }
    return document.createNode(value);
  }
  document.contents = node(template);
  return document.toString({ directives: false, lineWidth: 0 });
}
