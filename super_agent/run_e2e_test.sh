#!/bin/bash
set -e

# Ensure we are in the project root or super-agent root
cd "$(dirname "$0")/.."

echo "Starting Super-Agent E2E Verification..."

# Ensure we can find the module
export PYTHONPATH=$PYTHONPATH:$(pwd)/super-agent

# run the agent with the test config
python3 -m super_agent.cli --worker-type stub run --config super-agent/test_data/e2e_stub_test.json

echo "Verification complete. Check the output above for session ID and status."
