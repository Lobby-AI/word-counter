from datetime import datetime
from pydantic import BaseModel
from typing import List


class TargetStatementsBySpeaker(BaseModel):
    speaker_name: str
    statement_contents: List[str]


class AllTargetStatements(BaseModel):
    start_period: datetime
    end_period: datetime
    target_statements_list_by_speaker: List[TargetStatementsBySpeaker]


class WordCountBySpeaker(BaseModel):
    word: str
    speaker_name: str
    count: int


class AllWordCount(BaseModel):
    word: str
    start_period: datetime
    end_period: datetime
    word_count_list: List[WordCountBySpeaker]
