import firebase_admin
from firebase_admin import credentials, firestore
import os

# Path to the service account key file
cred_path = "service-account.json"

if not os.path.exists(cred_path):
    print(f"Error: {cred_path} not found!")
    exit(1)

print(f"Loading credentials from {cred_path}...")
try:
    cred = credentials.Certificate(cred_path)
    firebase_admin.initialize_app(cred)
    print("Firebase initialized successfully.")
except Exception as e:
    print(f"Error initializing Firebase: {e}")
    exit(1)

db = firestore.client()
print(f"Attempting to connect to project: {db.project}")

try:
    # Try to write a test document
    doc_ref = db.collection('test_connection').document('ping')
    doc_ref.set({'message': 'pong', 'timestamp': firestore.SERVER_TIMESTAMP})
    print("✅ Write successful!")
    
    # Try to read it back
    doc = doc_ref.get()
    print(f"✅ Read successful: {doc.to_dict()}")
    
    print("\n🎉 Connection verified! The database exists and is accessible.")
except Exception as e:
    print(f"\n❌ Connection failed: {e}")
