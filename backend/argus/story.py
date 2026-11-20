"""Which articles tell the same story.

GDELT clusters articles by where and when, so one "event" can hold
several stories that happened to mention the same city. Here an
article is the words of its link (or a headline), lightly stemmed and
weighted by how rare they are across the day's coverage: "russia" and
"strikes" are everywhere and count for little, "dnipro" and "bridges"
count for a lot. Two articles tell the same story when their weighted
words are close enough (cosine similarity).

Pure functions, no AI and no outside data.
"""

import math
import re
from collections import Counter
from collections.abc import Iterable
from urllib.parse import urlsplit

# Words in links and headlines that say nothing about the story.
_STOP_TEXT = """
    the and for with from into onto over after before about against
    amid among says said say tells told new news latest live update
    updates breaking report reports reported video watch photos
    photo pictures what when where who why how this that these those
    are was were has have had not but its his her their they them our
    you your will would could should can may might also just more most
    than then there here out off all any some one two three four five
    six seven eight nine ten first last next day days week weeks year
    years today yesterday tonight morning night time times now amp
    html htm php aspx article articles story stories world national
    international local politics opinion section category pages page
    details content index www com org net post posts top headline
    headlines feed rss cnn usa nation region regional
    middle east europe asia africa americas emea global
    january february march april june july august september october
    november december monday tuesday wednesday thursday friday
    saturday sunday
"""
STOPWORDS = frozenset(_STOP_TEXT.split())

# Nationality and place spellings folded to one word.
FOLD = {
    "russian": "russia",
    "russians": "russia",
    "ukrainian": "ukraine",
    "ukrainians": "ukraine",
    "israeli": "israel",
    "israelis": "israel",
    "iranian": "iran",
    "iranians": "iran",
    "polish": "poland",
    "chinese": "china",
    "syrian": "syria",
    "lebanese": "lebanon",
    "palestinian": "palestine",
    "palestinians": "palestine",
    "saudi": "saudi",
    "yemeni": "yemen",
    "sudanese": "sudan",
    "american": "america",
    "americans": "america",
    "british": "britain",
    "venezuelan": "venezuela",
    "pakistani": "pakistan",
    "indian": "india",
    "afghan": "afghanistan",
    "iraqi": "iraq",
    "turkish": "turkey",
    "korean": "korea",
    "japanese": "japan",
    "mexican": "mexico",
    "haitian": "haiti",
    "nigerian": "nigeria",
    "somali": "somalia",
    "kyiv": "kyiv",
    "kiev": "kyiv",
}

SUFFIXES = ("ings", "ing", "ies", "ers", "ed", "es", "er", "s")


def stem(word: str) -> str:
    """A crude stem: plurals and verb endings off, at most 7 letters
    ("strikes" and "striking" are both "strik")."""
    word = FOLD.get(word, word)
    for suffix in SUFFIXES:
        if len(word) - len(suffix) >= 4 and word.endswith(suffix):
            word = word[: -len(suffix)]
            if suffix == "ies":
                word += "y"
            break
    if len(word) > 5 and word.endswith("e"):
        word = word[:-1]
    return word[:7]


def words(text: str) -> list[str]:
    return [
        stem(w)
        for w in re.findall(r"[a-z]{3,}", text.lower())
        if w not in STOPWORDS
    ]


def link_text(url: str) -> str:
    """The readable part of a link: its path, without ids and dates."""
    path = urlsplit(url or "").path.lower().replace("_", "-")
    return " ".join(re.findall(r"[a-z]{3,}", path))


def link_terms(url: str) -> set[str]:
    return set(words(link_text(url)))


def title_terms(title: str) -> set[str]:
    return set(words(title or ""))


MIN_TERMS = 3


def readable(terms: set[str]) -> bool:
    """Enough words to judge what the article is about."""
    return len(terms) >= MIN_TERMS


class Weights:
    """Inverse document frequency over a set of articles: a word in
    every article weighs little, a rare one a lot."""

    def __init__(self, docs: Iterable[set[str]] = ()) -> None:
        self.df: Counter = Counter()
        self.n = 0
        for d in docs:
            self.add(d)

    def add(self, terms: set[str]) -> None:
        self.n += 1
        self.df.update(terms)

    def weight(self, term: str) -> float:
        # Smoothed; unseen words weigh the most.
        return math.log((1 + self.n) / (1 + self.df.get(term, 0))) + 1

    def similarity(self, a: set[str], b: set[str]) -> float:
        """Cosine similarity of two articles' weighted words, 0 to 1."""
        if not a or not b:
            return 0.0
        shared = a & b
        if not shared:
            return 0.0
        wa = math.sqrt(sum(self.weight(t) ** 2 for t in a))
        wb = math.sqrt(sum(self.weight(t) ** 2 for t in b))
        dot = sum(self.weight(t) ** 2 for t in shared)
        return dot / (wa * wb)


# Two links tell the same story at this similarity or above.
SAME_STORY = 0.3


def clusters(
    items: list[set[str]], weights: Weights, threshold: float = SAME_STORY
) -> list[list[int]]:
    """Group articles into stories (indexes into items), biggest first.
    An article joins a story when it's close to any article in it."""
    parent = list(range(len(items)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            if find(i) == find(j):
                continue
            if weights.similarity(items[i], items[j]) >= threshold:
                parent[find(j)] = find(i)
    groups: dict[int, list[int]] = {}
    for i in range(len(items)):
        groups.setdefault(find(i), []).append(i)
    return sorted(groups.values(), key=len, reverse=True)


def best_match(
    terms: set[str], others: Iterable[set[str]], weights: Weights
) -> float:
    """How close an article is to the closest of others."""
    return max((weights.similarity(terms, o) for o in others), default=0.0)


def shared_story(
    a: list[set[str]],
    b: list[set[str]],
    weights: Weights,
    threshold: float = SAME_STORY,
) -> float:
    """The share of a's readable articles that match one of b's."""
    a = [t for t in a if readable(t)]
    b = [t for t in b if readable(t)]
    if not a or not b:
        return 0.0
    hits = sum(best_match(t, b, weights) >= threshold for t in a)
    return hits / len(a)
