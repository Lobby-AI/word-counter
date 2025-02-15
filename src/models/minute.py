from pydantic import BaseModel
from typing import List


class Statement(BaseModel):
    speaker_name: str
    content: str


class Minute(BaseModel):
    meeting_title: str
    hold_date: str
    statements: List[Statement]
