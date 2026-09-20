-- Run once as a database administrator, with IAM DB authentication enabled.
CREATE USER 'app_user'@'%' IDENTIFIED WITH AWSAuthenticationPlugin AS 'RDS';
ALTER USER 'app_user'@'%' REQUIRE SSL;
GRANT CREATE TEMPORARY TABLES ON app.* TO 'app_user'@'%';
-- For application tables, also grant the required SELECT/INSERT/UPDATE/DELETE privileges.
