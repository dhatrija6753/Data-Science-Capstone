import pandas as pd
import sqlite3
import os

def migrate_kaggle_data():
    csv_file = 'grocery_chain_data.csv'
    if not os.path.exists(csv_file):
        print("CSV not found!")
        return

    df = pd.read_csv(csv_file)
    df_to_load = df[['product_name', 'unit_price', 'store_name', 'transaction_date']].copy()
    df_to_load.columns = ['item_name', 'price', 'store', 'date']

    conn = sqlite3.connect('smart_splitwise.db')
    df_to_load.to_sql('purchase_history', conn, if_exists='append', index=False)
    conn.close()
    print(f"Loaded {len(df_to_load)} history records.")

if __name__ == "__main__":
    migrate_kaggle_data()