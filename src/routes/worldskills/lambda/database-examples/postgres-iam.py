import boto3
import psycopg

REGION = "eu-central-1"
DB_HOST = "my-db.abcdefghijkl.eu-central-1.rds.amazonaws.com"
DB_PORT = 5432
DB_NAME = "app"
DB_USER = "app_user"
DB_CA_FILE = "/opt/certs/rds.pem"

rds = boto3.client("rds", region_name=REGION)


def handler(event, context):
    token = rds.generate_db_auth_token(
        DBHostname=DB_HOST, Port=DB_PORT, DBUsername=DB_USER, Region=REGION
    )
    with psycopg.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=token,
        sslmode="verify-full", sslrootcert=DB_CA_FILE, connect_timeout=5,
        options="-c statement_timeout=10000",
    ) as db:
        with db.cursor() as cur:
            cur.execute("SELECT %s::text AS message, current_user", ("IAM connected",))
            message, user = cur.fetchone()
            return {"message": message, "user": user}
