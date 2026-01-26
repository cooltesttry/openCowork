import asyncio
import sys
import os
import json
import shutil
from pathlib import Path

# Fix import path (assuming running from project root)
sys.path.append(os.getcwd())

# Import Super Agent modules
# Note: Ensure 'super_agent' symlink exists in cwd
try:
    from super_agent.orchestrator import AsyncOrchestrator
    from super_agent.models import TaskDefinition, WorkerConfig, WorkerResult, CheckerResult
    from super_agent.worker import Worker
    from super_agent.checker import Checker
except ImportError:
    # Alternative import if package structure is flat
    sys.path.append(os.path.join(os.getcwd(), "super-agent"))
    from orchestrator import AsyncOrchestrator
    from models import TaskDefinition, WorkerConfig, WorkerResult, CheckerResult
    from worker import Worker
    from checker import Checker


class ScriptedWorker(Worker):
    """
    A specific Mock Worker that follows a pre-defined script of actions
    based on the cycle_count.
    """
    async def run_async(self, config, task, input_payload, workspace):
        cycle = input_payload.get("cycle_index", 1)  # Orchestrator doesn't pass cycle directly in input yet, logic need adjustment?
        # WAIT: In the current Orchestrator.run_once, input_payload is passed. 
        # But 'cycle_index' is not automatically injected into input_payload by Orchestrator before calling worker.
        # We need to rely on some other state or just internal counter if Orchestrator creates a new worker instance?
        # Actually, Orchestrator keeps the same worker instance. So we can use self.counter.
        
        if not hasattr(self, "internal_cycle"):
            self.internal_cycle = 0
        self.internal_cycle += 1
        
        print(f"\n[ScriptedWorker] Running Cycle #{self.internal_cycle}")
        workspace.mkdir(parents=True, exist_ok=True)

        if self.internal_cycle == 1:
            # === SCENARIO 1: FORGETFUL AGENT ===
            # Writes the file but forgets __output.json
            print("[ScriptedWorker] Action: Writing hello.py but FORGETTING __output.json")
            (workspace / "hello.py").write_text("print('hello world')")
            
            return WorkerResult(
                status="ok", 
                output={"text": "I wrote hello.py"}, 
                summary="Wrote code (Forgot Protocol)"
            )

        elif self.internal_cycle == 2:
            # === SCENARIO 2: CORRECTION ===
            # Reads the feedback (implicitly), and writes correct output
            print("[ScriptedWorker] Action: Writing __output.json correctly")
            
            # Create valid output
            output_data = {
                "summary": "Created hello.py and fixed protocol",
                "text_content": "Here is the result",
                "files": ["hello.py"],
                "instruction_to_user": "Run python hello.py"
            }
            (workspace / "__output.json").write_text(json.dumps(output_data))
            
            return WorkerResult(
                status="ok", 
                output={}, 
                summary="Fixed Protocol"
            )
            
        return WorkerResult(status="error", output={}, summary="Unexpected Cycle")


class ProtocolChecker(Checker):
    """
    A checker that enforces the existence of __output.json logic 
    (which is handled by Orchestrator actually).
    
    The Orchestrator blindly ingests __output.json. 
    If __output.json is missing, result.output will NOT have 'files' or 'summary' from the file.
    So this Checker checks if the ingestion happened.
    """
    async def check(self, task, result, cycle_index):
        print(f"[ProtocolChecker] Checking Result Keys: {list(result.output.keys())}")
        
        # Check if Orchestrator successfully ingested the file
        if "files" in result.output and "hello.py" in result.output["files"]:
            print("[ProtocolChecker] -> PASS: Found valid schema and files.")
            return CheckerResult(passed=True, reason="protocol_adhered")
        
        # If missing
        print("[ProtocolChecker] -> FAIL: Protocol violation. '__output.json' content missing.")
        return CheckerResult(
            passed=False, 
            reason="protocol_violation", 
            next_input={
                "review_feedback": "CRITICAL: You failed to write '__output.json'. You MUST write this file with the 'files' list."
            }
        )

async def run_test():
    # Setup
    workspace_root = Path("tests/workspace_sim")
    if workspace_root.exists():
        shutil.rmtree(workspace_root)
    workspace_root.mkdir(parents=True)
    
    # Init
    config = WorkerConfig(id="sim-worker", name="Sim", model="mock")
    task = TaskDefinition(task_id="sim-task", name="Sim Task", objective="Write Hello World")
    
    worker = ScriptedWorker()
    checker = ProtocolChecker()
    
    # We need to manually inject the Store path or let Orchestrator manage it
    # We'll rely on default Orchestrator temp dirs but mapped to our test folder if possible
    # For now, let's just use default Orchestrator behavior which creates its own workspace
    orchestrator = AsyncOrchestrator(worker=worker, checker=checker)
    
    print("=== Starting Simulation ===")
    session = orchestrator.create_session(task, config, max_cycles=5)
    
    # Run loop
    session = await orchestrator.run(session.session_id)
    
    print(f"\n=== Simulation Finished ===")
    print(f"Final Status: {session.status}")
    print(f"Total Cycles: {session.cycle_count}")
    
    # Assertions
    assert session.cycle_count == 2, f"Expected 2 cycles, got {session.cycle_count}"
    assert session.status == "completed", "Session should be completed"
    print("\n[SUCCESS] The Forgetful Agent was successfully corrected!")

if __name__ == "__main__":
    asyncio.run(run_test())
