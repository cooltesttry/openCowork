import asyncio
import sys
from pathlib import Path

# Add current dir to path
sys.path.append(str(Path(__file__).parent.parent))

from super_agent.orchestrator import AsyncOrchestrator
from super_agent.models import TaskDefinition, WorkerConfig, LLMResult, CheckerResult
from super_agent.worker import StubWorker
from super_agent.checker import Checker

class MockReflectiveChecker(Checker):
    def __init__(self, failures_before_pass=2):
        self.counter = 0
        self.failures_before_pass = failures_before_pass

    async def check(self, task, result, cycle_index):
        self.counter += 1
        print(f"[MockChecker] Checking Cycle {cycle_index}...")
        
        if self.counter <= self.failures_before_pass:
            print(f"[MockChecker] -> REJECTING (Attempt {self.counter})")
            return CheckerResult(
                passed=False, 
                reason="mock_reject", 
                next_input={"review_feedback": f"Please improve. Attempt {self.counter} failed."}
            )
        
        print(f"[MockChecker] -> PASSING")
        return CheckerResult(passed=True, reason="mock_pass")

async def main():
    config = WorkerConfig(id="test-worker", name="Test", model="claude-3-5-sonnet")
    task = TaskDefinition(task_id="t1", objective="Test Loop", inputs={"start": "true"})
    
    # We want it to fail twice, then pass.
    # Cycle 1: Fail
    # Cycle 2: Fail
    # Cycle 3: Pass
    checker = MockReflectiveChecker(failures_before_pass=2)
    orchestrator = AsyncOrchestrator(worker=StubWorker(), checker=checker)
    
    print("Starting Session...")
    session = orchestrator.create_session(task, config, max_cycles=5)
    
    session = await orchestrator.run(session.session_id)
    
    print(f"\nFinal Status: {session.status}")
    print(f"Total Cycles: {session.cycle_count}")
    print("History:")
    for record in session.history:
        print(f" - Cycle {record.cycle_index}: Passed={record.passed}, InputKeys={list(record.input_payload.keys())}")
        if "review_feedback" in record.input_payload:
            print(f"   Feedback: {record.input_payload['review_feedback']}")

    assert session.status == "completed"
    assert session.cycle_count == 3
    print("\nSUCCESS: Loop verification passed!")

if __name__ == "__main__":
    asyncio.run(main())
