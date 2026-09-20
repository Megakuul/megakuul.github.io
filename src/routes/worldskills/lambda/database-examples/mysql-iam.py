import boto3
import pymysql

REGION = "eu-central-1"
DB_HOST = "my-db.abcdefghijkl.eu-central-1.rds.amazonaws.com"
DB_PORT = 3306
DB_NAME = "app"
DB_USER = "app_user"
DB_CA_FILE = "/opt/certs/rds.pem"

rds = boto3.client("rds", region_name=REGION)


def handler(event, context):
    token = rds.generate_db_auth_token(
        DBHostname=DB_HOST, Port=DB_PORT, DBUsername=DB_USER, Region=REGION
    )
    db = pymysql.connect(
        host=DB_HOST, port=DB_PORT, database=DB_NAME, user=DB_USER, password=token,
        ssl_ca=DB_CA_FILE, ssl_verify_cert=True, ssl_verify_identity=True,
        connect_timeout=5, read_timeout=10, write_timeout=10,
    )
    try:
        with db.cursor() as cur:
            cur.execute("SELECT %s AS message, CURRENT_USER()", ("IAM connected",))
            message, user = cur.fetchone()
            return {"message": message, "user": user}
    finally:
        db.close()
