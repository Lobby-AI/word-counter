import streamlit as st


def create_search_form():
    search_word = st.text_input("検索する単語", "", help="複数の単語を検索したい場合はカンマ区切りで入力して下さい。")
    col1, col2 = st.columns(2)
    with col1:
        start_date = st.date_input("開始日")
    with col2:
        end_date = st.date_input("終了日")
    return search_word, start_date, end_date
