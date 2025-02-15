import streamlit as st

from datetime import datetime

from src.counter.counter import WordCounter
from src.ui.components import create_search_form
from src.ui.visualization import create_word_count_graph
from src.utils.logger import setup_logger


logger = setup_logger()

PICKLE_PATH = "pickle/shizuoka/sorted_minute_list.pickle"


def main():
    st.title("発言カウント")

    with st.sidebar:
        search_word, start_period, end_period = create_search_form()
        if start_period > end_period:
            st.warning("開始日は終了日以前に設定して下さい設定して下さい。")
            return
        # 検索ボタン
        search_button = st.button("検索")
    if search_button and search_word:
        counter = WordCounter(PICKLE_PATH, logger)
        start_datetime = datetime.combine(start_period, datetime.min.time())
        end_datetime = datetime.combine(end_period, datetime.max.time())

        try:
            result = counter.count_word_witin_period(search_word, start_datetime, end_datetime)
            if len(result.word_count_list) == 0:
                st.warning(
                    f"{start_period.strftime('%Y/%m/%d')}から{end_period.strftime('%Y/%m/%d')}の期間に議事録が存在しません。"
                )
                return
            st.header(f"「{result.word}」の発言回数")

            fig = create_word_count_graph(result, start_period, end_period)
            st.plotly_chart(fig)

        except Exception as e:
            st.error(f"エラーが発生しました: {str(e)}")

    elif search_button:
        st.warning("検索する単語を入力してください。")


if __name__ == "__main__":
    main()
