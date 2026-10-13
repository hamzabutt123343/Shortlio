"""Devanagari → Hinglish (roman) transliteration for burned captions."""

from __future__ import annotations

import re
import unicodedata

# Independent vowels
_VOWELS = {
    "अ": "a",
    "आ": "aa",
    "इ": "i",
    "ई": "ee",
    "उ": "u",
    "ऊ": "oo",
    "ऋ": "ri",
    "ए": "e",
    "ऐ": "ai",
    "ओ": "o",
    "औ": "au",
    "ऑ": "o",
}

# Consonants (inherent 'a' added later unless virama/matra follows)
_CONSONANTS = {
    "क": "k",
    "ख": "kh",
    "ग": "g",
    "घ": "gh",
    "ङ": "ng",
    "च": "ch",
    "छ": "chh",
    "ज": "j",
    "झ": "jh",
    "ञ": "ny",
    "ट": "t",
    "ठ": "th",
    "ड": "d",
    "ढ": "dh",
    "ण": "n",
    "त": "t",
    "थ": "th",
    "द": "d",
    "ध": "dh",
    "न": "n",
    "प": "p",
    "फ": "ph",
    "ब": "b",
    "भ": "bh",
    "म": "m",
    "य": "y",
    "र": "r",
    "ल": "l",
    "व": "v",
    "श": "sh",
    "ष": "sh",
    "स": "s",
    "ह": "h",
    "क्ष": "ksh",
    "त्र": "tr",
    "ज्ञ": "gy",
    "क़": "q",
    "ख़": "kh",
    "ग़": "g",
    "ज़": "z",
    "ड़": "d",
    "ढ़": "dh",
    "फ़": "f",
    "य़": "y",
}

# Dependent vowel signs (matras)
_MATRAS = {
    "ा": "a",
    "ि": "i",
    "ी": "ee",
    "ु": "u",
    "ू": "oo",
    "ृ": "ri",
    "े": "e",
    "ै": "ai",
    "ो": "o",
    "ौ": "au",
    "ॉ": "o",
    "ं": "n",
    "ँ": "n",
    "ः": "h",
}

_VIRAMA = "्"
_NUKTA = "़"

# Common whole-word overrides (natural Hinglish spellings)
_WORD_OVERRIDES = {
    "है": "hai",
    "हैं": "hain",
    "नहीं": "nahi",
    "क्या": "kya",
    "यह": "yeh",
    "वो": "wo",
    "वह": "woh",
    "मैं": "main",
    "आप": "aap",
    "तुम": "tum",
    "और": "aur",
    "के": "ke",
    "की": "ki",
    "का": "ka",
    "को": "ko",
    "से": "se",
    "पर": "par",
    "में": "mein",
    "भी": "bhi",
    "तो": "to",
    "ही": "hi",
    "हो": "ho",
    "था": "tha",
    "थी": "thi",
    "थे": "the",
    "गया": "gaya",
    "गए": "gaye",
    "रहा": "raha",
    "रही": "rahi",
    "लिए": "liye",
    "बात": "baat",
    "अच्छा": "achha",
    "ठीक": "theek",
    "भाई": "bhai",
    "यार": "yaar",
    "मतलब": "matlab",
    "बस": "bas",
    "हाँ": "haan",
    "हां": "haan",
    "नही": "nahi",
    "क्यों": "kyun",
    "कैसे": "kaise",
    "कहाँ": "kahan",
    "कब": "kab",
    "कौन": "kaun",
    "बहुत": "bahut",
    "अभी": "abhi",
    "फिर": "phir",
    "लेकिन": "lekin",
    "अगर": "agar",
    "जब": "jab",
    "तक": "tak",
    "साथ": "saath",
    "बाद": "baad",
    "पहले": "pehle",
    "समय": "samay",
    "लोग": "log",
    "दुनिया": "duniya",
    "जिंदगी": "zindagi",
    "प्यार": "pyaar",
    "दिल": "dil",
    "पल": "pal",
    "खास": "khaas",
    "खासः": "khaas",
    "क्षण": "kshan",
    "वीडियो": "video",
    "मज़ा": "maza",
    "मजा": "maja",
    "देखो": "dekho",
    "सुनो": "suno",
    "बोलो": "bolo",
    "करो": "karo",
    "जाओ": "jao",
    "आओ": "aao",
    "हूँ": "hoon",
    "हूं": "hoon",
    "हूं।": "hoon",
}


def _has_devanagari(text: str) -> bool:
    return any("\u0900" <= ch <= "\u097F" for ch in text)


def _transliterate_word(word: str) -> str:
    if word in _WORD_OVERRIDES:
        return _WORD_OVERRIDES[word]

    # Multi-char conjuncts first
    w = word.replace("क्ष", "क\u094dष").replace("त्र", "त\u094dर").replace("ज्ञ", "ज\u094dञ")
    out: list[str] = []
    i = 0
    n = len(w)
    while i < n:
        ch = w[i]
        if ch in _VOWELS:
            out.append(_VOWELS[ch])
            i += 1
            continue
        if ch in _CONSONANTS:
            base = _CONSONANTS[ch]
            i += 1
            # nukta
            if i < n and w[i] == _NUKTA:
                i += 1
            # virama → no inherent vowel, maybe next consonant cluster
            if i < n and w[i] == _VIRAMA:
                out.append(base)
                i += 1
                continue
            # matra
            if i < n and w[i] in _MATRAS:
                matra = w[i]
                i += 1
                if matra in ("ं", "ँ", "ः"):
                    out.append(base + "a" + _MATRAS[matra])
                else:
                    out.append(base + _MATRAS[matra])
                # anusvara after matra
                if i < n and w[i] in ("ं", "ँ"):
                    out.append("n")
                    i += 1
                continue
            out.append(base + "a")
            continue
        if ch in _MATRAS:
            out.append(_MATRAS[ch])
            i += 1
            continue
        if ch in (_VIRAMA, _NUKTA, "्", "़"):
            i += 1
            continue
        if ch.isspace() or unicodedata.category(ch).startswith("P"):
            out.append(ch)
            i += 1
            continue
        # Keep Latin / digits / other scripts as-is
        out.append(ch)
        i += 1

    roman = "".join(out)
    # Cleanup common artifacts
    roman = re.sub(r"aa+", "aa", roman)
    roman = re.sub(r"([kgcjtdpb])h{2,}", r"\1h", roman)
    # Final schwa deletion: pala→pal, bahuta→bahut (Hinglish convention)
    if (
        len(roman) > 2
        and roman.endswith("a")
        and not roman.endswith(("aa", "ai", "au", "ia", "ya", "wa"))
        and roman not in {"ka", "ke", "ki", "ko", "se", "to", "ho", "na", "tha", "thi", "the", "ra", "sa"}
    ):
        roman = roman[:-1]
    return roman


def to_hinglish(text: str) -> str:
    """Convert Hindi/Devanagari (or mixed) text to readable Hinglish roman script."""
    if not text or not text.strip():
        return text
    if not _has_devanagari(text):
        # Already roman / English — light normalize common tokens
        return text.strip()

    parts = re.findall(r"[\u0900-\u097F]+|[^\u0900-\u097F]+", text)
    out: list[str] = []
    for part in parts:
        if _has_devanagari(part):
            # Split on punctuation inside Devanagari runs rarely needed
            words = re.split(r"(\s+)", part)
            for w in words:
                if not w or w.isspace():
                    out.append(w)
                else:
                    out.append(_transliterate_word(w))
        else:
            out.append(part)
    result = "".join(out)
    result = re.sub(r"\s+", " ", result).strip()
    return result
