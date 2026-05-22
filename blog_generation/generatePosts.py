import json
import os
from datetime import datetime

blog_posts: list = []

def parse_blog_posts(folder_path: str, save_path: str):

    dir: bytes = os.fsencode(folder_path)
    save_dir: bytes = os.fsencode(save_path)

    for file in os.listdir(dir):
        filename: str = os.fsdecode(file)
        filepath = os.path.join(dir, file)

        with open(filepath, 'r', encoding='utf-8') as f:
            content: str = f.read()
            formatted_filename = os.path.splitext(filename)[0]
            author_date, title = formatted_filename.split('_', 1)

            new_post: dict[str, str] = {
                "tag": formatted_filename,
                "title": title,
                "date": datetime.strptime(author_date, '%Y-%m-%d').strftime('%d %B, %Y'),
                "body": content,
                "timestamp": author_date
            }
            blog_posts.append(new_post)

    # Sort by timestamp ascending. The timestamp field will not actually be used after this
    # Not efficient but how much will I end up writing really?
    blog_posts.sort(key = lambda x: datetime.strptime(x["timestamp"], '%Y-%m-%d'), reverse = True)
    filename: bytes = os.fsencode("posts.json")
    save_filepath: str = os.path.join(save_dir, filename)
    with open(save_filepath, 'w') as f:
        json.dump(blog_posts, f, indent=4)


if __name__ == "__main__":
    # paths are designed such that this works if run within blog_generation
    parse_blog_posts(folder_path = "./raw_posts", save_path = "../posts")