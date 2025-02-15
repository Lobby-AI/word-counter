import pickle

from collections import defaultdict
from datetime import datetime
from logging import Logger
from typing import Dict, List

from src.models.minute import Minute
from src.models.word_counter import TargetStatementsBySpeaker, AllTargetStatements, WordCountBySpeaker, AllWordCount
from src.utils.process_str import convert_to_half_width


class WordCounter:
    def __init__(self, pickle_path: str, logger: Logger):
        with open(pickle_path, "rb") as f:
            self.all_minute_list: List[Minute] = pickle.load(f)
        self.target_minute_list: List[Minute] = self.all_minute_list
        self.logger = logger

    def _get_minutes_within_period(self, start_period: datetime, end_period: datetime):
        """
        start_periodからend_periodまでに開催された会議の議事録データをリストで返す
        Args:
            start_period (datetime): 検索期間の開始日
            end_period (str); 検索期間の終了日
        """
        try:
            filtered_minutes = list(
                filter(
                    lambda x: (
                        start_period <= datetime.strptime(x.hold_date, "%Y-%m-%d")
                        and datetime.strptime(x.hold_date, "%Y-%m-%d") <= end_period
                    ),
                    self.all_minute_list,
                )
            )
            self.logger.debug(filtered_minutes)
        except Exception as e:
            self.logger.error(f"議事録データの抽出中にエラーが発生しました: {e}")
            raise
        return filtered_minutes

    def _group_statement_by_speaker(self, minutes: List[Minute]):
        """
        議事録データのリストから発言者ごとの全発言のリストを作成する
        Args:
            minutes (List[Minute]): 議事録データのリスト
        """
        try:
            speaker_content: Dict[str, List[str]] = defaultdict(list)
            for minute in minutes:
                for statement in minute.statements:
                    speaker_content[statement.speaker_name].append(convert_to_half_width(statement.content))
            target_statements_list = [
                TargetStatementsBySpeaker(speaker_name=speaker, statement_contents=contents)
                for speaker, contents in speaker_content.items()
            ]
            self.logger.debug(target_statements_list)
        except Exception as e:
            self.logger.error(f"発言者ごとの発言リストの作成中にエラーが発生しました: {e}")
            raise
        return target_statements_list

    def _count_word(self, word: str, statements: List[str]):
        """
        発言リスト中の与えられた単語の出現回数をカウントする
        """
        return sum(statement.count(word) for statement in statements)

    def _count_word_by_speaker(self, target_statements_list: List[TargetStatementsBySpeaker], word: str):
        """
        発言者ごとに与えられた単語の発言回数をカウントする
        Args:
            target_statements_list (List[TargetStatementsBySpeaker]): 発言者ごとの発言リストをまとめたリスト
            word (str): カウントしたい単語
        """
        try:
            word_count_list: List[WordCountBySpeaker] = []
            for target_statements_by_speaker in target_statements_list:
                count = self._count_word(word, target_statements_by_speaker.statement_contents)
                word_count_list.append(
                    WordCountBySpeaker(word=word, speaker_name=target_statements_by_speaker.speaker_name, count=count)
                )
            self.logger.debug(word_count_list)
        except Exception as e:
            self.logger.error(f"発言者ごとの単語のカウント中にエラーが発生しました: {e}")
            raise
        return word_count_list

    def count_word_witin_period(self, word: str, start_period: datetime, end_period: datetime):
        """
        期間を指定して与えられた単語の発言回数をカウントする
        Args:
            word (str): カウントしたい単語
            start_period (str): 検索期間の開始日
            end_period (str); 検索期間の終了日
        """
        try:
            # 日付の条件があう議事録データをリストで取得
            self.target_minute_list = self._get_minutes_within_period(start_period, end_period)
            # 議事録データのリストを発言者ごとの全発言のリストに変換
            target_statements_list = self._group_statement_by_speaker(self.target_minute_list)
            _ = AllTargetStatements(
                start_period=start_period,
                end_period=end_period,
                target_statements_list_by_speaker=target_statements_list,
            )
            # 発言者ごとにwordの発言回数をカウント
            word_count_list = self._count_word_by_speaker(target_statements_list, word)
            all_word_count_result = AllWordCount(
                word=word, start_period=start_period, end_period=end_period, word_count_list=word_count_list
            )
        except Exception as e:
            self.logger.error(f"単語のカウント中にエラーが発生しました: {e}")
        return all_word_count_result
