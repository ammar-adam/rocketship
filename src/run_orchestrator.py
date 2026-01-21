"""
Run orchestrator - manages run state and artifacts.
Writes status.json, universe.json, rocket_scores.json, logs.txt
"""
import json
import os
from datetime import datetime
from typing import List, Dict, Any


class RunOrchestrator:
    """Manages run execution and artifact writing"""
    
    def __init__(self, run_id: str, base_dir: str = "runs"):
        self.run_id = run_id
        self.run_dir = os.path.join(base_dir, run_id)
        os.makedirs(self.run_dir, exist_ok=True)
        
    def write_status(self, stage: str, progress: Dict[str, Any] = None, errors: List[str] = None):
        """Write status.json with current run state - flushes immediately"""
        status = {
            "runId": self.run_id,
            "stage": stage,  # "setup" | "rocket" | "debate" | "optimize" | "done" | "error"
            "progress": progress or {"done": 0, "total": 0, "current": None, "message": ""},
            "updatedAt": datetime.utcnow().isoformat() + "Z",
            "errors": errors or []
        }
        
        status_path = os.path.join(self.run_dir, "status.json")
        # Write to temp file first, then rename (atomic on most filesystems)
        temp_path = status_path + ".tmp"
        with open(temp_path, 'w') as f:
            json.dump(status, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp_path, status_path)
    
    def write_universe(self, mode: str, tickers: List[str]):
        """Write universe.json with input configuration"""
        universe = {
            "mode": mode,  # "sp500" or "import"
            "tickers": tickers,
            "count": len(tickers),
            "createdAt": datetime.utcnow().isoformat() + "Z"
        }
        
        universe_path = os.path.join(self.run_dir, "universe.json")
        with open(universe_path, 'w') as f:
            json.dump(universe, f, indent=2)
    
    def write_rocket_scores(self, scores: List[Dict[str, Any]]):
        """Write rocket_scores.json with stage 1 results"""
        rocket_scores_path = os.path.join(self.run_dir, "rocket_scores.json")
        with open(rocket_scores_path, 'w') as f:
            json.dump(scores, f, indent=2)
    
    def append_log(self, message: str):
        """Append line to logs.txt with immediate flush"""
        logs_path = os.path.join(self.run_dir, "logs.txt")
        timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
        log_line = f"[{timestamp}] {message}"
        with open(logs_path, 'a') as f:
            f.write(log_line + "\n")
            f.flush()
        # Also print to stdout for Node.js capture
        print(log_line, flush=True)
    
    def convert_top25_to_rocket_scores(self):
        """Convert existing top_25.json to rocket_scores.json format"""
        top25_path = os.path.join(self.run_dir, "top_25.json")
        
        if not os.path.exists(top25_path):
            return []
        
        with open(top25_path, 'r') as f:
            top25_data = json.load(f)
        
        # Convert to rocket_scores.json schema
        rocket_scores = []
        for item in top25_data:
            # Extract tags from macro_trends_matched
            tags = []
            if 'macro_trends_matched' in item:
                tags = [trend.get('name', '').split()[0] for trend in item['macro_trends_matched']]
            
            rocket_score = {
                "ticker": item.get("ticker", ""),
                "sector": item.get("sector", ""),
                "current_price": item.get("current_price", 0),
                "rocket_score": item.get("rocket_score", 0),
                "technical_score": item.get("technical_score", 0),
                "macro_score": item.get("macro_score", 0),
                "breakdown": item.get("breakdown", {}),
                "tags": tags,
                "macro_trends_matched": item.get("macro_trends_matched", [])
            }
            rocket_scores.append(rocket_score)
        
        return rocket_scores
