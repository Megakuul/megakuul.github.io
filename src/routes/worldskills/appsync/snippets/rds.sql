CREATE TABLE IF NOT EXISTS items (
  owner text NOT NULL,
  id text NOT NULL,
  title varchar(200) NOT NULL,
  version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (owner, id)
);
