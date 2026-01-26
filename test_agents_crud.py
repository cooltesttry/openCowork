import requests
import json
import sys

BASE_URL = "http://localhost:8000/api/agents"

def test_crud():
    print("Testing CRUD operations...")
    
    # 1. List - verify default
    print("\n1. Listing workers...")
    res = requests.get(BASE_URL)
    if res.status_code != 200:
        print(f"Failed to list: {res.text}")
        return False
    data = res.json()
    workers = data.get("workers", [])
    print(f"Found {len(workers)} workers")
    
    # 2. Create
    print("\n2. Creating new worker...")
    new_worker = {
        "id": "test_worker",
        "name": "Test Worker",
        "model": "claude-3-5-sonnet-20241022",
        "preserve_context": True,
        "max_turns": 5
    }
    res = requests.post(BASE_URL, json=new_worker)
    if res.status_code != 200:
        print(f"Failed to create: {res.text}")
        return False
    print("Created successfully")
    
    # 3. Verify Created details
    print("\n3. Verifying details...")
    res = requests.get(f"{BASE_URL}/test_worker")
    if res.status_code != 200:
        print(f"Failed to get detail: {res.text}")
        return False
    worker = res.json().get("worker")
    if worker["preserve_context"] is not True:
        print("ERROR: preserve_context not saved correctly")
        return False
    print(f"Verified preserve_context={worker['preserve_context']}")
    
    # 4. Update
    print("\n4. Updating worker...")
    worker["max_turns"] = 20
    worker["preserve_context"] = False
    res = requests.put(f"{BASE_URL}/test_worker", json=worker)
    if res.status_code != 200:
        print(f"Failed to update: {res.text}")
        return False
    print("Updated successfully")
    
    # 5. Verify Update
    res = requests.get(f"{BASE_URL}/test_worker")
    updated_worker = res.json().get("worker")
    if updated_worker["max_turns"] != 20 or updated_worker["preserve_context"] is not False:
        print("ERROR: Update didn't persist correctly")
        return False
    print("Verified updates persisted")
    
    # 6. Delete
    print("\n6. Deleting worker...")
    res = requests.delete(f"{BASE_URL}/test_worker")
    if res.status_code != 200:
        print(f"Failed to delete: {res.text}")
        return False
    print("Deleted successfully")
    
    # 7. Verify Deletion
    res = requests.get(f"{BASE_URL}/test_worker")
    if res.status_code != 404:
        print("ERROR: Worker still exists after delete")
        return False
    print("Verified deletion")
    
    return True

if __name__ == "__main__":
    try:
        if test_crud():
            print("\nALL TESTS PASSED")
        else:
            print("\nTESTS FAILED")
            sys.exit(1)
    except requests.exceptions.ConnectionError:
        print("\nERROR: Could not connect to backend. Is the server running?")
        sys.exit(1)
