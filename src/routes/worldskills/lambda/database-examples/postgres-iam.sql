-- Run once as a database administrator, with IAM DB authentication enabled.
CREATE USER app_user;
GRANT rds_iam TO app_user;
GRANT CONNECT, TEMPORARY ON DATABASE app TO app_user;
-- For application tables, also grant the required schema/table privileges.
