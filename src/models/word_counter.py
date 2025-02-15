from datetime import datetime
from pydantic import BaseModel
from typing import List


class TargetStatements(BaseModel):
    speaker_name: str
    statement_contents: List[str]


class TargetStatementsBySpeaker(BaseModel):
    start_period: datetime
    end_period: datetime
    target_statements_per_speaker: List[TargetStatement]


class WordCountBySpeaker(BaseModel):
    word: str
    speaker_name: str
    count: int


class WordCount(BaseModel):
    word: str
    word_count_list: List[WordCountBySpeaker]
