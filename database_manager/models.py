import sqlite3

def init_db():
    conn = sqlite3.connect('smart_splitwise.db')
    cursor = conn.cursor()
    # Create tables
    cursor.execute('''CREATE TABLE IF NOT EXISTS purchase_history (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        item_name TEXT, price REAL, store TEXT, date TEXT)''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS store_prices (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        item_name TEXT, price REAL, store_name TEXT, last_updated TEXT)''')
    conn.commit()
    conn.close()
    print("Database structure created!")

if __name__ == "__main__":
    init_db()