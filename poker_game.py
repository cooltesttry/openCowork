#!/usr/bin/env python3
"""
德州扑克 - 命令行版
Texas Hold'em Poker - CLI Edition

完整的德州扑克游戏，支持1-5个AI对手，
包含完整的手牌评估、下注轮次、边池计算等功能。

纯Python实现，无外部依赖。
"""

import os
import sys
import random
import time
from enum import IntEnum, Enum
from itertools import combinations
from typing import List, Optional, Tuple, Dict


# =============================================================================
# 常量与枚举
# =============================================================================

class Suit(Enum):
    """花色"""
    SPADE = ("♠", "spade")
    HEART = ("♥", "heart")
    DIAMOND = ("♦", "diamond")
    CLUB = ("♣", "club")

    @property
    def symbol(self) -> str:
        return self.value[0]

    @property
    def is_red(self) -> bool:
        return self in (Suit.HEART, Suit.DIAMOND)


class Rank(IntEnum):
    """牌面大小"""
    TWO = 2
    THREE = 3
    FOUR = 4
    FIVE = 5
    SIX = 6
    SEVEN = 7
    EIGHT = 8
    NINE = 9
    TEN = 10
    JACK = 11
    QUEEN = 12
    KING = 13
    ACE = 14

    @property
    def symbol(self) -> str:
        symbols = {
            2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8",
            9: "9", 10: "10", 11: "J", 12: "Q", 13: "K", 14: "A"
        }
        return symbols[self.value]


class HandRank(IntEnum):
    """手牌等级"""
    HIGH_CARD = 1
    ONE_PAIR = 2
    TWO_PAIR = 3
    THREE_OF_A_KIND = 4
    STRAIGHT = 5
    FLUSH = 6
    FULL_HOUSE = 7
    FOUR_OF_A_KIND = 8
    STRAIGHT_FLUSH = 9
    ROYAL_FLUSH = 10

    @property
    def chinese_name(self) -> str:
        names = {
            1: "高牌", 2: "一对", 3: "两对", 4: "三条",
            5: "顺子", 6: "同花", 7: "葫芦", 8: "四条",
            9: "同花顺", 10: "皇家同花顺"
        }
        return names[self.value]


class Action(Enum):
    """玩家动作"""
    FOLD = "弃牌"
    CHECK = "过牌"
    CALL = "跟注"
    RAISE = "加注"
    ALL_IN = "全押"


# =============================================================================
# ANSI 颜色工具
# =============================================================================

class Color:
    """ANSI 颜色码"""
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    UNDERLINE = "\033[4m"

    RED = "\033[91m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    MAGENTA = "\033[95m"
    CYAN = "\033[96m"
    WHITE = "\033[97m"

    BG_GREEN = "\033[42m"
    BG_BLUE = "\033[44m"
    BG_RED = "\033[41m"
    BG_WHITE = "\033[47m"
    BG_DARK = "\033[40m"

    @staticmethod
    def red(text: str) -> str:
        return f"{Color.RED}{text}{Color.RESET}"

    @staticmethod
    def green(text: str) -> str:
        return f"{Color.GREEN}{text}{Color.RESET}"

    @staticmethod
    def yellow(text: str) -> str:
        return f"{Color.YELLOW}{text}{Color.RESET}"

    @staticmethod
    def blue(text: str) -> str:
        return f"{Color.BLUE}{text}{Color.RESET}"

    @staticmethod
    def cyan(text: str) -> str:
        return f"{Color.CYAN}{text}{Color.RESET}"

    @staticmethod
    def magenta(text: str) -> str:
        return f"{Color.MAGENTA}{text}{Color.RESET}"

    @staticmethod
    def bold(text: str) -> str:
        return f"{Color.BOLD}{text}{Color.RESET}"

    @staticmethod
    def dim(text: str) -> str:
        return f"{Color.DIM}{text}{Color.RESET}"


# =============================================================================
# 牌与牌组
# =============================================================================

class Card:
    """扑克牌"""

    def __init__(self, rank: Rank, suit: Suit):
        self.rank = rank
        self.suit = suit

    def __repr__(self) -> str:
        return f"{self.rank.symbol}{self.suit.symbol}"

    def __eq__(self, other) -> bool:
        if not isinstance(other, Card):
            return False
        return self.rank == other.rank and self.suit == other.suit

    def __hash__(self) -> int:
        return hash((self.rank, self.suit))

    def colored_str(self) -> str:
        """带颜色的牌面字符串"""
        text = f"{self.rank.symbol}{self.suit.symbol}"
        if self.suit.is_red:
            return Color.red(text)
        return Color.bold(text)

    def box_str(self, hidden: bool = False) -> List[str]:
        """卡牌盒子显示，返回多行字符串列表"""
        if hidden:
            return [
                "┌───┐",
                "│░░░│",
                "│░░░│",
                "│░░░│",
                "└───┘"
            ]
        rank_str = self.rank.symbol
        suit_str = self.suit.symbol
        # 确保排名字符串对齐（10需要特殊处理）
        if len(rank_str) == 1:
            top = f"│{rank_str}  │"
            bot = f"│  {rank_str}│"
        else:
            top = f"│{rank_str} │"
            bot = f"│ {rank_str}│"

        lines = [
            "┌───┐",
            top,
            f"│ {suit_str} │",
            bot,
            "└───┘"
        ]

        if self.suit.is_red:
            return [Color.red(line) for line in lines]
        return lines


class Deck:
    """一副扑克牌"""

    def __init__(self):
        self.cards: List[Card] = []
        self.reset()

    def reset(self):
        """重置并洗牌"""
        self.cards = [Card(rank, suit) for suit in Suit for rank in Rank]
        random.shuffle(self.cards)

    def deal(self, n: int = 1) -> List[Card]:
        """发牌"""
        dealt = self.cards[:n]
        self.cards = self.cards[n:]
        return dealt

    def deal_one(self) -> Card:
        """发一张牌"""
        return self.deal(1)[0]


# =============================================================================
# 手牌评估器
# =============================================================================

class HandResult:
    """手牌评估结果"""

    def __init__(self, hand_rank: HandRank, primary: List[int], kickers: List[int],
                 best_five: List[Card]):
        self.hand_rank = hand_rank
        self.primary = primary      # 主要比较值
        self.kickers = kickers      # 踢脚牌
        self.best_five = best_five  # 最佳5张牌

    @property
    def score(self) -> Tuple:
        """用于比较的分数元组"""
        return (self.hand_rank.value, tuple(self.primary), tuple(self.kickers))

    def __gt__(self, other: 'HandResult') -> bool:
        return self.score > other.score

    def __lt__(self, other: 'HandResult') -> bool:
        return self.score < other.score

    def __eq__(self, other: 'HandResult') -> bool:
        return self.score == other.score

    def __ge__(self, other: 'HandResult') -> bool:
        return self.score >= other.score

    def __le__(self, other: 'HandResult') -> bool:
        return self.score <= other.score

    def description(self) -> str:
        """中文描述"""
        cards_str = " ".join(c.colored_str() for c in self.best_five)
        return f"{Color.yellow(self.hand_rank.chinese_name)} [{cards_str}]"


class HandEvaluator:
    """手牌评估器 - 从7张牌中选出最佳5张"""

    @staticmethod
    def evaluate(hole_cards: List[Card], community_cards: List[Card]) -> HandResult:
        """评估最佳手牌"""
        all_cards = hole_cards + community_cards
        best_result = None

        for combo in combinations(all_cards, 5):
            result = HandEvaluator._evaluate_five(list(combo))
            if best_result is None or result > best_result:
                best_result = result

        return best_result

    @staticmethod
    def _evaluate_five(cards: List[Card]) -> HandResult:
        """评估5张牌的手牌"""
        ranks = sorted([c.rank.value for c in cards], reverse=True)
        suits = [c.suit for c in cards]

        is_flush = len(set(suits)) == 1
        is_straight, straight_high = HandEvaluator._check_straight(ranks)

        rank_counts: Dict[int, int] = {}
        for r in ranks:
            rank_counts[r] = rank_counts.get(r, 0) + 1

        counts_sorted = sorted(rank_counts.items(), key=lambda x: (x[1], x[0]), reverse=True)

        # 皇家同花顺
        if is_flush and is_straight and straight_high == 14:
            return HandResult(HandRank.ROYAL_FLUSH, [14], [], cards)

        # 同花顺
        if is_flush and is_straight:
            return HandResult(HandRank.STRAIGHT_FLUSH, [straight_high], [], cards)

        # 四条
        if counts_sorted[0][1] == 4:
            quad_rank = counts_sorted[0][0]
            kicker = counts_sorted[1][0]
            return HandResult(HandRank.FOUR_OF_A_KIND, [quad_rank], [kicker], cards)

        # 葫芦
        if counts_sorted[0][1] == 3 and counts_sorted[1][1] == 2:
            trip_rank = counts_sorted[0][0]
            pair_rank = counts_sorted[1][0]
            return HandResult(HandRank.FULL_HOUSE, [trip_rank, pair_rank], [], cards)

        # 同花
        if is_flush:
            return HandResult(HandRank.FLUSH, [], ranks, cards)

        # 顺子
        if is_straight:
            return HandResult(HandRank.STRAIGHT, [straight_high], [], cards)

        # 三条
        if counts_sorted[0][1] == 3:
            trip_rank = counts_sorted[0][0]
            kickers = sorted([r for r, c in counts_sorted if c == 1], reverse=True)
            return HandResult(HandRank.THREE_OF_A_KIND, [trip_rank], kickers, cards)

        # 两对
        if counts_sorted[0][1] == 2 and counts_sorted[1][1] == 2:
            pair1 = max(counts_sorted[0][0], counts_sorted[1][0])
            pair2 = min(counts_sorted[0][0], counts_sorted[1][0])
            kicker = [r for r, c in counts_sorted if c == 1][0]
            return HandResult(HandRank.TWO_PAIR, [pair1, pair2], [kicker], cards)

        # 一对
        if counts_sorted[0][1] == 2:
            pair_rank = counts_sorted[0][0]
            kickers = sorted([r for r, c in counts_sorted if c == 1], reverse=True)
            return HandResult(HandRank.ONE_PAIR, [pair_rank], kickers, cards)

        # 高牌
        return HandResult(HandRank.HIGH_CARD, [], ranks, cards)

    @staticmethod
    def _check_straight(ranks: List[int]) -> Tuple[bool, int]:
        """检查是否是顺子，返回(是否顺子, 最大牌面值)"""
        unique = sorted(set(ranks), reverse=True)
        if len(unique) < 5:
            return False, 0

        # 普通顺子
        if unique[0] - unique[4] == 4:
            return True, unique[0]

        # A-2-3-4-5 (轮子)
        if unique == [14, 5, 4, 3, 2]:
            return True, 5  # 5高顺子

        return False, 0


# =============================================================================
# 玩家
# =============================================================================

class AIStyle(Enum):
    """AI 风格"""
    TIGHT = "tight"          # 紧手 - 只玩好牌
    AGGRESSIVE = "aggressive" # 激进 - 频繁加注
    LOOSE = "loose"          # 松手 - 什么牌都玩
    BLUFFER = "bluffer"      # 诈唬 - 经常虚张声势
    BALANCED = "balanced"    # 均衡 - 综合型


# AI 名字和风格描述
AI_PROFILES = {
    AIStyle.TIGHT: ("铁公鸡", "谨慎型，只在拿到好牌时才出手"),
    AIStyle.AGGRESSIVE: ("赌神", "激进型，喜欢大额加注压迫对手"),
    AIStyle.LOOSE: ("小鱼", "松散型，喜欢参与每一手牌"),
    AIStyle.BLUFFER: ("狐狸", "诈唬型，擅长虚张声势"),
    AIStyle.BALANCED: ("赌侠", "均衡型，难以捉摸"),
}


class Player:
    """玩家基类"""

    def __init__(self, name: str, chips: int, is_human: bool = False):
        self.name = name
        self.chips = chips
        self.is_human = is_human
        self.hole_cards: List[Card] = []
        self.is_folded = False
        self.is_all_in = False
        self.current_bet = 0
        self.total_bet_this_hand = 0

    def reset_for_new_hand(self):
        """新一手牌重置"""
        self.hole_cards = []
        self.is_folded = False
        self.is_all_in = False
        self.current_bet = 0
        self.total_bet_this_hand = 0

    @property
    def is_active(self) -> bool:
        """是否仍在游戏中"""
        return not self.is_folded and not self.is_all_in and self.chips > 0

    def bet(self, amount: int) -> int:
        """下注，返回实际下注金额"""
        actual = min(amount, self.chips)
        self.chips -= actual
        self.current_bet += actual
        self.total_bet_this_hand += actual
        if self.chips == 0:
            self.is_all_in = True
        return actual

    def display_name(self) -> str:
        """显示名称"""
        if self.is_human:
            return Color.cyan(f"👤 {self.name}")
        return Color.magenta(f"🤖 {self.name}")


class AIPlayer(Player):
    """AI 玩家"""

    def __init__(self, name: str, chips: int, style: AIStyle):
        super().__init__(name, chips, is_human=False)
        self.style = style
        self.style_desc = AI_PROFILES[style][1]

    def _hand_strength_preflop(self) -> float:
        """评估起手牌强度 (0.0 - 1.0)"""
        if len(self.hole_cards) < 2:
            return 0.0

        c1, c2 = self.hole_cards
        r1, r2 = c1.rank.value, c2.rank.value
        high, low = max(r1, r2), min(r1, r2)
        suited = c1.suit == c2.suit

        score = 0.0

        # 口袋对子
        if r1 == r2:
            score = 0.5 + (r1 - 2) / 24.0  # 22=0.5, AA=1.0
            return min(score, 1.0)

        # 高牌价值
        score += (high - 2) / 24.0 + (low - 2) / 48.0

        # 同花加分
        if suited:
            score += 0.06

        # 连牌加分
        gap = high - low
        if gap == 1:
            score += 0.05
        elif gap == 2:
            score += 0.03
        elif gap == 3:
            score += 0.01

        # AK, AQ, AJ 等
        if high == 14:
            if low >= 11:
                score += 0.15
            elif low >= 10:
                score += 0.08

        return min(max(score, 0.0), 1.0)

    def _hand_strength_postflop(self, community_cards: List[Card]) -> float:
        """评估翻牌后手牌强度"""
        if not community_cards:
            return self._hand_strength_preflop()

        result = HandEvaluator.evaluate(self.hole_cards, community_cards)
        rank = result.hand_rank.value

        # 根据手牌等级计算基础强度
        base_scores = {
            1: 0.10, 2: 0.30, 3: 0.50, 4: 0.60,
            5: 0.70, 6: 0.75, 7: 0.82, 8: 0.92,
            9: 0.97, 10: 1.00
        }
        strength = base_scores.get(rank, 0.10)

        # 对子以上，根据牌面大小微调
        if rank >= 2:
            if result.primary:
                strength += (result.primary[0] - 2) / 120.0

        # 高牌时根据踢脚牌调整
        if rank == 1 and result.kickers:
            strength = 0.05 + result.kickers[0] / 140.0

        return min(max(strength, 0.0), 1.0)

    def decide(self, community_cards: List[Card], current_bet: int,
               min_raise: int, pot_size: int, num_active: int,
               stage: str) -> Tuple[Action, int]:
        """AI 决策，返回 (动作, 金额)"""

        if stage == "preflop":
            strength = self._hand_strength_preflop()
        else:
            strength = self._hand_strength_postflop(community_cards)

        to_call = current_bet - self.current_bet
        pot_odds = to_call / (pot_size + to_call) if (pot_size + to_call) > 0 else 0

        # 根据风格调整阈值
        fold_threshold, call_threshold, raise_threshold = self._get_thresholds(stage)

        # 添加随机性
        noise = random.uniform(-0.08, 0.08)
        adjusted_strength = strength + noise

        # 诈唬逻辑
        if self.style == AIStyle.BLUFFER:
            if random.random() < 0.25:
                adjusted_strength += 0.25

        # 决策
        if to_call == 0:
            # 可以过牌
            if adjusted_strength >= raise_threshold:
                raise_amount = self._calc_raise(strength, pot_size, min_raise)
                if raise_amount > 0 and self.chips >= to_call + raise_amount:
                    return Action.RAISE, to_call + raise_amount
            return Action.CHECK, 0

        # 需要跟注
        if adjusted_strength < fold_threshold:
            # 考虑底池赔率
            if pot_odds < 0.15 and to_call <= self.chips * 0.05:
                return Action.CALL, to_call
            return Action.FOLD, 0

        if adjusted_strength >= raise_threshold:
            raise_amount = self._calc_raise(strength, pot_size, min_raise)
            total_needed = to_call + raise_amount
            if total_needed >= self.chips:
                # All-in 决策
                if adjusted_strength >= 0.7 or (self.style == AIStyle.AGGRESSIVE and adjusted_strength >= 0.5):
                    return Action.ALL_IN, self.chips
                return Action.CALL, min(to_call, self.chips)
            if raise_amount > 0:
                return Action.RAISE, total_needed
            return Action.CALL, min(to_call, self.chips)

        if adjusted_strength >= call_threshold:
            if to_call >= self.chips:
                if adjusted_strength >= 0.55:
                    return Action.ALL_IN, self.chips
                return Action.FOLD, 0
            return Action.CALL, min(to_call, self.chips)

        # 接近弃牌但底池赔率合适
        if pot_odds < 0.2 and to_call <= self.chips * 0.1:
            return Action.CALL, min(to_call, self.chips)

        return Action.FOLD, 0

    def _get_thresholds(self, stage: str) -> Tuple[float, float, float]:
        """获取不同风格的行动阈值 (弃牌, 跟注, 加注)"""
        thresholds = {
            AIStyle.TIGHT: {
                "preflop": (0.45, 0.35, 0.65),
                "flop": (0.40, 0.30, 0.60),
                "turn": (0.45, 0.35, 0.65),
                "river": (0.50, 0.40, 0.70),
            },
            AIStyle.AGGRESSIVE: {
                "preflop": (0.25, 0.15, 0.40),
                "flop": (0.25, 0.15, 0.35),
                "turn": (0.30, 0.20, 0.40),
                "river": (0.35, 0.25, 0.45),
            },
            AIStyle.LOOSE: {
                "preflop": (0.15, 0.10, 0.55),
                "flop": (0.20, 0.12, 0.50),
                "turn": (0.25, 0.15, 0.55),
                "river": (0.30, 0.20, 0.60),
            },
            AIStyle.BLUFFER: {
                "preflop": (0.30, 0.20, 0.45),
                "flop": (0.25, 0.15, 0.40),
                "turn": (0.30, 0.20, 0.45),
                "river": (0.35, 0.25, 0.50),
            },
            AIStyle.BALANCED: {
                "preflop": (0.35, 0.25, 0.55),
                "flop": (0.30, 0.20, 0.50),
                "turn": (0.35, 0.25, 0.55),
                "river": (0.40, 0.30, 0.60),
            },
        }
        t = thresholds.get(self.style, thresholds[AIStyle.BALANCED])
        return t.get(stage, t["flop"])

    def _calc_raise(self, strength: float, pot_size: int, min_raise: int) -> int:
        """计算加注金额"""
        if self.style == AIStyle.AGGRESSIVE:
            multiplier = random.uniform(0.6, 1.2)
        elif self.style == AIStyle.BLUFFER:
            multiplier = random.uniform(0.5, 1.5)
        elif self.style == AIStyle.TIGHT:
            multiplier = random.uniform(0.4, 0.7)
        else:
            multiplier = random.uniform(0.3, 0.8)

        raise_amount = max(min_raise, int(pot_size * multiplier))

        # 根据手牌强度调整
        if strength > 0.8:
            raise_amount = int(raise_amount * random.uniform(1.2, 2.0))

        return raise_amount


# =============================================================================
# 底池管理（含边池）
# =============================================================================

class Pot:
    """底池"""

    def __init__(self):
        self.main_pot = 0
        self.side_pots: List[Tuple[int, List[Player]]] = []  # (金额, 有资格的玩家列表)

    @property
    def total(self) -> int:
        return self.main_pot + sum(sp[0] for sp in self.side_pots)


class PotManager:
    """底池管理器，处理边池计算"""

    @staticmethod
    def calculate_pots(players: List[Player]) -> List[Tuple[int, List[Player]]]:
        """
        计算主池和边池。
        返回: [(池大小, [有资格的玩家列表]), ...]
        """
        # 获取所有还在的玩家（未弃牌的）
        active_players = [p for p in players if not p.is_folded]
        all_players_with_bets = [(p, p.total_bet_this_hand) for p in players if p.total_bet_this_hand > 0]

        if not all_players_with_bets:
            return [(0, active_players)]

        # 获取所有唯一的下注金额并排序
        bet_levels = sorted(set(bet for _, bet in all_players_with_bets))

        pots = []
        prev_level = 0

        for level in bet_levels:
            pot_amount = 0
            eligible = []
            contribution_per_player = level - prev_level

            for player, bet in all_players_with_bets:
                if bet >= level:
                    pot_amount += contribution_per_player
                elif bet > prev_level:
                    pot_amount += bet - prev_level

            # 有资格分享此池的玩家（未弃牌且下注足够）
            for player in active_players:
                if player.total_bet_this_hand >= level:
                    eligible.append(player)

            if pot_amount > 0:
                pots.append((pot_amount, eligible))

            prev_level = level

        return pots if pots else [(0, active_players)]


# =============================================================================
# 显示工具
# =============================================================================

class Display:
    """CLI 显示工具"""

    @staticmethod
    def clear_screen():
        os.system('cls' if os.name == 'nt' else 'clear')

    @staticmethod
    def print_banner():
        banner = f"""
{Color.YELLOW}{Color.BOLD}
    ╔══════════════════════════════════════════════════════════╗
    ║                                                          ║
    ║          ♠  ♥  德 州 扑 克  ♦  ♣                         ║
    ║          Texas Hold'em Poker                             ║
    ║                                                          ║
    ╚══════════════════════════════════════════════════════════╝
{Color.RESET}"""
        print(banner)

    @staticmethod
    def print_divider(char: str = "─", length: int = 60):
        print(Color.dim(char * length))

    @staticmethod
    def print_cards_inline(cards: List[Card], hidden: bool = False):
        """横向打印牌"""
        if not cards:
            return
        if hidden:
            boxes = [Card(Rank.TWO, Suit.SPADE).box_str(hidden=True) for _ in cards]
        else:
            boxes = [c.box_str() for c in cards]

        for row in range(5):
            line = "  ".join(box[row] for box in boxes)
            print(f"    {line}")

    @staticmethod
    def print_community_cards(cards: List[Card], stage: str):
        """打印公共牌"""
        stage_names = {
            "preflop": "翻牌前",
            "flop": "翻牌 (Flop)",
            "turn": "转牌 (Turn)",
            "river": "河牌 (River)",
            "showdown": "摊牌 (Showdown)"
        }
        name = stage_names.get(stage, stage)
        print(f"\n  {Color.bold('🃏 公共牌')} - {Color.yellow(name)}")
        if cards:
            Display.print_cards_inline(cards)
        else:
            print(f"    {Color.dim('(尚未发牌)')}")

    @staticmethod
    def print_player_info(player: Player, is_dealer: bool = False,
                          is_sb: bool = False, is_bb: bool = False,
                          show_cards: bool = False):
        """打印玩家信息"""
        status = ""
        if player.is_folded:
            status = Color.dim(" [已弃牌]")
        elif player.is_all_in:
            status = Color.red(" [全押!]")

        position = ""
        if is_dealer:
            position += Color.yellow(" [D]")
        if is_sb:
            position += Color.blue(" [SB]")
        if is_bb:
            position += Color.green(" [BB]")

        chips_display = Color.yellow(f"${player.chips}")
        bet_display = ""
        if player.current_bet > 0:
            bet_display = Color.red(f" | 当前下注: ${player.current_bet}")

        print(f"  {player.display_name()}{position} | 筹码: {chips_display}{bet_display}{status}")

        if show_cards and player.hole_cards and not player.is_folded:
            cards_str = "  ".join(c.colored_str() for c in player.hole_cards)
            print(f"    手牌: {cards_str}")

    @staticmethod
    def print_pot(pot_total: int):
        """打印底池"""
        print(f"\n  {Color.bold('💰 底池')}: {Color.yellow(Color.bold(f'${pot_total}'))}")

    @staticmethod
    def print_action(player: Player, action: Action, amount: int = 0):
        """打印动作"""
        action_colors = {
            Action.FOLD: Color.dim,
            Action.CHECK: Color.green,
            Action.CALL: Color.blue,
            Action.RAISE: Color.yellow,
            Action.ALL_IN: Color.red,
        }
        color_fn = action_colors.get(action, Color.white)
        amount_str = f" ${amount}" if amount > 0 else ""
        print(f"    → {player.display_name()} {color_fn(action.value)}{color_fn(amount_str)}")

    @staticmethod
    def print_winner(player: Player, amount: int, hand_result: Optional[HandResult] = None):
        """打印赢家"""
        hand_desc = ""
        if hand_result:
            hand_desc = f" | {hand_result.description()}"
        print(f"  🏆 {player.display_name()} 赢得 {Color.yellow(f'${amount}')}{hand_desc}")

    @staticmethod
    def pause(message: str = "按回车继续..."):
        """暂停等待输入"""
        input(f"\n  {Color.dim(message)}")


# =============================================================================
# 游戏主类
# =============================================================================

class TexasHoldem:
    """德州扑克游戏"""

    SMALL_BLIND = 10
    BIG_BLIND = 20
    STARTING_CHIPS = 1000

    def __init__(self):
        self.players: List[Player] = []
        self.deck = Deck()
        self.community_cards: List[Card] = []
        self.pot = 0
        self.current_bet = 0
        self.min_raise = self.BIG_BLIND
        self.dealer_index = 0
        self.hand_number = 0
        self.stage = "preflop"
        self.action_log: List[str] = []

    def run(self):
        """运行游戏"""
        Display.clear_screen()
        Display.print_banner()

        # 创建玩家
        self._setup_players()

        # 游戏主循环
        while True:
            self.hand_number += 1

            # 检查玩家是否破产
            if self.players[0].chips <= 0:
                Display.clear_screen()
                Display.print_banner()
                print(f"\n  {Color.red('💸 你已经破产了！游戏结束。')}")
                self._print_final_standings()
                break

            # 移除破产的AI
            self.players = [p for p in self.players if p.chips > 0 or p.is_human]

            if len(self.players) < 2:
                Display.clear_screen()
                Display.print_banner()
                print(f"\n  {Color.green('🎉 恭喜！你打败了所有对手！')}")
                self._print_final_standings()
                break

            # 打一手牌
            self._play_hand()

            # 询问是否继续
            if not self._ask_continue():
                Display.clear_screen()
                Display.print_banner()
                print(f"\n  {Color.cyan('感谢游戏！再见！')}")
                self._print_final_standings()
                break

    def _setup_players(self):
        """设置玩家"""
        print(f"\n  {Color.bold('请选择对手数量 (1-5):')}")
        while True:
            try:
                choice = input(f"  > ").strip()
                num_opponents = int(choice)
                if 1 <= num_opponents <= 5:
                    break
                print(f"  {Color.red('请输入 1-5 之间的数字')}")
            except ValueError:
                print(f"  {Color.red('请输入有效数字')}")

        # 创建人类玩家
        print(f"\n  {Color.bold('请输入你的名字 (直接回车使用默认):')}")
        name = input(f"  > ").strip()
        if not name:
            name = "玩家"

        self.players = [Player(name, self.STARTING_CHIPS, is_human=True)]

        # 创建AI玩家
        styles = list(AIStyle)
        random.shuffle(styles)

        for i in range(num_opponents):
            style = styles[i % len(styles)]
            ai_name = AI_PROFILES[style][0]
            ai = AIPlayer(ai_name, self.STARTING_CHIPS, style)
            self.players.append(ai)

        # 打印玩家列表
        Display.clear_screen()
        Display.print_banner()
        print(f"\n  {Color.bold('参赛选手:')}")
        Display.print_divider()
        for p in self.players:
            if isinstance(p, AIPlayer):
                print(f"  {p.display_name()} | 风格: {Color.dim(p.style_desc)} | 筹码: {Color.yellow(f'${p.chips}')}")
            else:
                print(f"  {p.display_name()} | 筹码: {Color.yellow(f'${p.chips}')}")
        Display.print_divider()
        print(f"\n  {Color.dim(f'盲注: ${self.SMALL_BLIND}/${self.BIG_BLIND}')}")
        Display.pause()

    def _play_hand(self):
        """打一手牌"""
        # 重置
        self.deck.reset()
        self.community_cards = []
        self.pot = 0
        self.current_bet = 0
        self.min_raise = self.BIG_BLIND
        self.action_log = []

        for p in self.players:
            p.reset_for_new_hand()

        # 确定位置
        num_players = len(self.players)
        self.dealer_index = self.dealer_index % num_players

        if num_players == 2:
            # 单挑特殊规则：庄家=小盲
            sb_index = self.dealer_index
            bb_index = (self.dealer_index + 1) % num_players
        else:
            sb_index = (self.dealer_index + 1) % num_players
            bb_index = (self.dealer_index + 2) % num_players

        # 发盲注
        sb_player = self.players[sb_index]
        bb_player = self.players[bb_index]

        sb_actual = sb_player.bet(self.SMALL_BLIND)
        self.pot += sb_actual

        bb_actual = bb_player.bet(self.BIG_BLIND)
        self.pot += bb_actual

        self.current_bet = self.BIG_BLIND

        # 发手牌
        for p in self.players:
            p.hole_cards = self.deck.deal(2)

        # 显示游戏状态
        self._display_game_state("preflop")

        # === 翻牌前 ===
        self.stage = "preflop"
        if num_players == 2:
            first_actor = self.dealer_index  # 单挑：庄家先行动
        else:
            first_actor = (bb_index + 1) % num_players
        hand_over = self._betting_round(first_actor, is_preflop=True)

        if hand_over:
            self._award_pot_no_showdown()
            self.dealer_index = (self.dealer_index + 1) % len(self.players)
            return

        # === 翻牌 ===
        self.stage = "flop"
        self.deck.deal_one()  # 烧牌
        self.community_cards.extend(self.deck.deal(3))
        self._reset_bets_for_new_round()
        self._display_game_state("flop")

        if num_players == 2:
            first_actor = (self.dealer_index + 1) % num_players
        else:
            first_actor = (self.dealer_index + 1) % num_players
        hand_over = self._betting_round(first_actor)

        if hand_over:
            self._award_pot_no_showdown()
            self.dealer_index = (self.dealer_index + 1) % len(self.players)
            return

        # === 转牌 ===
        self.stage = "turn"
        self.deck.deal_one()  # 烧牌
        self.community_cards.append(self.deck.deal_one())
        self._reset_bets_for_new_round()
        self._display_game_state("turn")

        first_actor = (self.dealer_index + 1) % num_players
        hand_over = self._betting_round(first_actor)

        if hand_over:
            self._award_pot_no_showdown()
            self.dealer_index = (self.dealer_index + 1) % len(self.players)
            return

        # === 河牌 ===
        self.stage = "river"
        self.deck.deal_one()  # 烧牌
        self.community_cards.append(self.deck.deal_one())
        self._reset_bets_for_new_round()
        self._display_game_state("river")

        first_actor = (self.dealer_index + 1) % num_players
        hand_over = self._betting_round(first_actor)

        if hand_over:
            self._award_pot_no_showdown()
            self.dealer_index = (self.dealer_index + 1) % len(self.players)
            return

        # === 摊牌 ===
        self._showdown()
        self.dealer_index = (self.dealer_index + 1) % len(self.players)

    def _reset_bets_for_new_round(self):
        """新一轮下注前重置"""
        for p in self.players:
            p.current_bet = 0
        self.current_bet = 0
        self.min_raise = self.BIG_BLIND

    def _display_game_state(self, stage: str):
        """显示游戏状态"""
        Display.clear_screen()

        num_players = len(self.players)
        if num_players == 2:
            sb_index = self.dealer_index
            bb_index = (self.dealer_index + 1) % num_players
        else:
            sb_index = (self.dealer_index + 1) % num_players
            bb_index = (self.dealer_index + 2) % num_players

        # 标题
        print(f"\n  {Color.bold(f'═══ 第 {self.hand_number} 手牌 ═══')}")
        Display.print_divider()

        # 公共牌
        Display.print_community_cards(self.community_cards, stage)

        # 底池
        Display.print_pot(self.pot)

        # 玩家信息
        print(f"\n  {Color.bold('玩家:')}")
        Display.print_divider("─", 50)

        for i, p in enumerate(self.players):
            is_dealer = (i == self.dealer_index)
            is_sb = (i == sb_index)
            is_bb = (i == bb_index)
            show = p.is_human
            Display.print_player_info(p, is_dealer, is_sb, is_bb, show)

        Display.print_divider()

        # 最近的动作日志
        if self.action_log:
            print(f"\n  {Color.dim('最近动作:')}")
            for log_entry in self.action_log[-5:]:
                print(f"  {Color.dim(log_entry)}")

    def _get_active_players(self) -> List[Player]:
        """获取仍在游戏中的玩家（未弃牌）"""
        return [p for p in self.players if not p.is_folded]

    def _get_players_who_can_act(self) -> List[Player]:
        """获取可以行动的玩家（未弃牌且未全押）"""
        return [p for p in self.players if p.is_active]

    def _betting_round(self, first_actor: int, is_preflop: bool = False) -> bool:
        """
        执行一轮下注。
        返回 True 表示手牌结束（只剩一个玩家）。
        """
        num_players = len(self.players)
        players_acted = set()
        last_raiser = None
        current_actor = first_actor

        # 找到第一个可以行动的玩家
        for _ in range(num_players):
            p = self.players[current_actor]
            if p.is_active:
                break
            current_actor = (current_actor + 1) % num_players

        while True:
            active = self._get_active_players()
            can_act = self._get_players_who_can_act()

            # 只剩一个玩家未弃牌
            if len(active) <= 1:
                return True

            # 所有可行动的玩家都已行动且没有新的加注
            if len(can_act) == 0:
                return False

            player = self.players[current_actor]

            if player.is_folded or player.is_all_in:
                current_actor = (current_actor + 1) % num_players
                continue

            if player in players_acted and last_raiser != player:
                # 检查是否需要跟注
                if player.current_bet >= self.current_bet:
                    current_actor = (current_actor + 1) % num_players

                    # 检查是否回到最后加注者或所有人都行动过
                    all_matched = all(
                        p.current_bet >= self.current_bet or p.is_folded or p.is_all_in
                        for p in self.players
                    )
                    if all_matched and player in players_acted:
                        # 检查是否所有可行动玩家都行动过
                        remaining = [p for p in self.players if p.is_active and p not in players_acted]
                        if not remaining:
                            return False
                    continue

            # 获取玩家动作
            if player.is_human:
                action, amount = self._human_action(player)
            else:
                action, amount = player.decide(
                    self.community_cards, self.current_bet,
                    self.min_raise, self.pot,
                    len(active), self.stage
                )

            # 执行动作
            self._execute_action(player, action, amount)
            players_acted.add(player)

            if action == Action.RAISE or action == Action.ALL_IN:
                if player.current_bet > self.current_bet or (action == Action.ALL_IN and amount > 0):
                    last_raiser = player
                    # 如果加注了，其他人需要重新行动
                    players_acted = {player}

            # 更新显示
            self._display_game_state(self.stage)

            # 检查是否只剩一人
            if len(self._get_active_players()) <= 1:
                return True

            # 下一个玩家
            current_actor = (current_actor + 1) % num_players

            # 检查是否一轮结束
            all_settled = True
            for p in self.players:
                if p.is_folded or p.is_all_in:
                    continue
                if p not in players_acted:
                    all_settled = False
                    break
                if p.current_bet < self.current_bet:
                    all_settled = False
                    break

            if all_settled:
                return False

    def _human_action(self, player: Player) -> Tuple[Action, int]:
        """获取人类玩家的动作"""
        to_call = self.current_bet - player.current_bet

        print(f"\n  {Color.bold('轮到你行动了！')}")
        print(f"  你的手牌: {' '.join(c.colored_str() for c in player.hole_cards)}")
        print(f"  你的筹码: {Color.yellow(f'${player.chips}')}")
        if to_call > 0:
            print(f"  需要跟注: {Color.red(f'${to_call}')}")

        # 构建可用动作
        options = []
        option_map = {}

        if to_call == 0:
            options.append(f"1. {Color.green('过牌 (Check)')}")
            option_map[1] = Action.CHECK
        else:
            options.append(f"1. {Color.blue(f'跟注 (Call) ${min(to_call, player.chips)}')}")
            option_map[1] = Action.CALL

        if player.chips > to_call:
            options.append(f"2. {Color.yellow('加注 (Raise)')}")
            option_map[2] = Action.RAISE

        options.append(f"3. {Color.dim('弃牌 (Fold)')}")
        option_map[3] = Action.FOLD

        options.append(f"4. {Color.red(f'全押 (All-in) ${player.chips}')}")
        option_map[4] = Action.ALL_IN

        for opt in options:
            print(f"  {opt}")

        while True:
            try:
                choice = input(f"\n  请选择 > ").strip()
                choice_num = int(choice)

                if choice_num not in option_map:
                    print(f"  {Color.red('无效选项，请重新选择')}")
                    continue

                action = option_map[choice_num]

                if action == Action.CHECK:
                    return Action.CHECK, 0

                elif action == Action.CALL:
                    call_amount = min(to_call, player.chips)
                    return Action.CALL, call_amount

                elif action == Action.FOLD:
                    return Action.FOLD, 0

                elif action == Action.ALL_IN:
                    return Action.ALL_IN, player.chips

                elif action == Action.RAISE:
                    min_raise_total = self.current_bet + self.min_raise
                    max_raise = player.chips
                    print(f"\n  最小加注到: ${min_raise_total}")
                    print(f"  最大加注到: ${player.current_bet + max_raise}")
                    print(f"  (输入加注到的总数额)")

                    while True:
                        try:
                            raise_input = input(f"  加注到 > ").strip()
                            raise_to = int(raise_input)

                            if raise_to < min_raise_total:
                                print(f"  {Color.red(f'最少需要加注到 ${min_raise_total}')}")
                                continue

                            raise_amount = raise_to - player.current_bet
                            if raise_amount > player.chips:
                                print(f"  {Color.red(f'筹码不足！你只有 ${player.chips}')}")
                                continue

                            if raise_amount == player.chips:
                                return Action.ALL_IN, player.chips

                            return Action.RAISE, raise_amount

                        except ValueError:
                            print(f"  {Color.red('请输入有效数字')}")

            except ValueError:
                print(f"  {Color.red('请输入数字选项')}")

    def _execute_action(self, player: Player, action: Action, amount: int):
        """执行玩家动作"""
        if action == Action.FOLD:
            player.is_folded = True
            Display.print_action(player, action)
            self.action_log.append(f"{player.name} 弃牌")

        elif action == Action.CHECK:
            Display.print_action(player, action)
            self.action_log.append(f"{player.name} 过牌")

        elif action == Action.CALL:
            actual = player.bet(amount)
            self.pot += actual
            Display.print_action(player, action, actual)
            self.action_log.append(f"{player.name} 跟注 ${actual}")

        elif action == Action.RAISE:
            actual = player.bet(amount)
            self.pot += actual
            new_bet = player.current_bet
            if new_bet > self.current_bet:
                self.min_raise = new_bet - self.current_bet
                self.current_bet = new_bet
            Display.print_action(player, action, actual)
            self.action_log.append(f"{player.name} 加注到 ${new_bet}")

        elif action == Action.ALL_IN:
            actual = player.bet(amount)
            self.pot += actual
            new_bet = player.current_bet
            if new_bet > self.current_bet:
                self.min_raise = max(self.min_raise, new_bet - self.current_bet)
                self.current_bet = new_bet
            Display.print_action(player, action, actual)
            self.action_log.append(f"{player.name} 全押 ${actual}!")

        # 短暂延迟让AI动作更自然
        if not player.is_human:
            time.sleep(0.5)

    def _award_pot_no_showdown(self):
        """所有人弃牌，无需摊牌"""
        active = self._get_active_players()
        if len(active) == 1:
            winner = active[0]
            winner.chips += self.pot
            self._display_game_state(self.stage)
            print(f"\n  {Color.bold('所有其他玩家弃牌！')}")
            Display.print_winner(winner, self.pot)
            Display.pause()

    def _showdown(self):
        """摊牌"""
        self._display_game_state("showdown")
        active = [p for p in self.players if not p.is_folded]

        if len(active) <= 1:
            if active:
                active[0].chips += self.pot
                Display.print_winner(active[0], self.pot)
            Display.pause()
            return

        # 评估所有手牌
        print(f"\n  {Color.bold('═══ 摊牌 ═══')}")
        Display.print_divider()

        results: Dict[Player, HandResult] = {}
        for p in active:
            result = HandEvaluator.evaluate(p.hole_cards, self.community_cards)
            results[p] = result
            cards_str = " ".join(c.colored_str() for c in p.hole_cards)
            print(f"  {p.display_name()} 的手牌: {cards_str}")
            print(f"    → {result.description()}")

        Display.print_divider()

        # 计算边池
        pots = PotManager.calculate_pots(self.players)

        total_awarded = 0
        for pot_amount, eligible in pots:
            if pot_amount == 0:
                continue

            # 从eligible中过滤出有评估结果的
            eligible_with_results = [(p, results[p]) for p in eligible if p in results]

            if not eligible_with_results:
                # 如果没有有效玩家，给第一个还在的
                if active:
                    active[0].chips += pot_amount
                    Display.print_winner(active[0], pot_amount)
                    total_awarded += pot_amount
                continue

            # 找最佳手牌
            best_result = max(r for _, r in eligible_with_results)
            winners = [p for p, r in eligible_with_results if r == best_result]

            # 分钱
            share = pot_amount // len(winners)
            remainder = pot_amount % len(winners)

            for i, winner in enumerate(winners):
                award = share + (1 if i < remainder else 0)
                winner.chips += award
                total_awarded += award

                pot_desc = ""
                if len(pots) > 1:
                    pot_desc = f" (边池)"
                Display.print_winner(winner, award, results[winner])

        # 检查是否还有未分配的筹码（由浮点误差或边池计算导致）
        unallocated = self.pot - total_awarded
        if unallocated > 0 and active:
            active[0].chips += unallocated

        Display.pause()

    def _ask_continue(self) -> bool:
        """询问是否继续"""
        print(f"\n  {Color.bold('当前筹码:')}")
        for p in self.players:
            status = ""
            if p.chips <= 0:
                status = Color.red(" [已淘汰]")
            print(f"  {p.display_name()}: {Color.yellow(f'${p.chips}')}{status}")

        print(f"\n  {Color.bold('继续下一手？')}")
        print(f"  1. {Color.green('继续')}")
        print(f"  2. {Color.red('退出')}")

        while True:
            choice = input(f"  > ").strip()
            if choice == "1" or choice == "":
                return True
            if choice == "2":
                return False
            print(f"  {Color.dim('请输入 1 或 2')}")

    def _print_final_standings(self):
        """打印最终排名"""
        print(f"\n  {Color.bold('═══ 最终排名 ═══')}")
        Display.print_divider()

        sorted_players = sorted(self.players, key=lambda p: p.chips, reverse=True)
        for i, p in enumerate(sorted_players):
            medal = ""
            if i == 0:
                medal = "🥇"
            elif i == 1:
                medal = "🥈"
            elif i == 2:
                medal = "🥉"
            else:
                medal = f"  {i + 1}."

            profit = p.chips - self.STARTING_CHIPS
            profit_str = ""
            if profit > 0:
                profit_str = Color.green(f" (+${profit})")
            elif profit < 0:
                profit_str = Color.red(f" (-${abs(profit)})")

            print(f"  {medal} {p.display_name()}: {Color.yellow(f'${p.chips}')}{profit_str}")

        Display.print_divider()
        print(f"\n  {Color.cyan('感谢游玩德州扑克！祝你好运！')}\n")


# =============================================================================
# 程序入口
# =============================================================================

def main():
    """主函数"""
    try:
        game = TexasHoldem()
        game.run()
    except KeyboardInterrupt:
        print(f"\n\n  {Color.cyan('游戏已中断。再见！')}\n")
        sys.exit(0)
    except EOFError:
        print(f"\n\n  {Color.cyan('游戏已结束。再见！')}\n")
        sys.exit(0)


if __name__ == "__main__":
    main()
