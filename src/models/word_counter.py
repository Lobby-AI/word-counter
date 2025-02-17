from datetime import datetime
from pydantic import BaseModel
from typing import List


class StatementsBySpeaker(BaseModel):
    speaker_name: str
    statement_contents: List[str]


class AllStatements(BaseModel):
    start_period: datetime
    end_period: datetime
    statements_list: List[StatementsBySpeaker]


class AllStatementsCountainsWord(BaseModel):
    word: str
    all_statements: AllStatements


class WordCountBySpeaker(BaseModel):
    word: str
    speaker_name: str
    count: int


class AllWordCount(BaseModel):
    word: str
    start_period: datetime
    end_period: datetime
    word_count_list: List[WordCountBySpeaker]
