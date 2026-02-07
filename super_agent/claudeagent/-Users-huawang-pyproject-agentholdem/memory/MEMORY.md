# AgentHoldem Project Memory

## Project Structure
- `/Users/huawang/pyproject/agentholdem/` - Limit Texas Hold'em CLI game
- `agentholdem/` - main package (card, deck, hand_eval, player, game, ai, cli, __main__)
- `tests/` - pytest test suite (104 tests)
- `.venv/` - Python virtual environment with pytest

## Key Patterns
- Game uses callback pattern: `game.action_handlers[player_name] = callable(GameState) -> Action`
- AI returns string actions ("fold", "check", "call", "raise"), CLI converts via `Action(str)`
- Stage enum has `.value` as string ("preflop", etc.) - AI compares against `Stage.PREFLOP` enum
- Chip conservation is critical - always verify `sum(chips) == initial_total`
- Side pot calculation uses sorted unique bet levels, not per-player iteration

## Lessons Learned
- In Limit Hold'em: preflop big blind counts as 1st bet, so only 3 more raises allowed
- Heads-up: button posts SB and acts first preflop; non-button acts first postflop
- BET vs RAISE distinction: BET when no prior bet, RAISE when there is one. Use `_normalize_action()` to handle AI returning "raise" when it should be "bet"
- `Action[name]` looks up by NAME, `Action(value)` by VALUE - use `Action(str)` for string values
