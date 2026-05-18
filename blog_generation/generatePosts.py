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
            # filename is the title
            # tag is also the title
            # date is the time since last modification
            # body is the text itself
            formatted_filename = os.path.splitext(filename)[0]

            new_post: dict[str, str] = {
                "tag": formatted_filename,
                "title": formatted_filename,
                "date": datetime.fromtimestamp(os.path.getmtime(filepath)).strftime('%d %B, %Y'),
                "body": content
            }
            blog_posts.append(new_post)

    filename: str = os.fsencode("posts.json")
    save_filepath: str = os.path.join(save_dir, filename)
    with open(save_filepath, 'w') as f:
        json.dump(blog_posts, f, indent=4)


if __name__ == "__main__":
    # paths are designed such that this works if run within blog_generation
    parse_blog_posts(folder_path = "./raw_posts", save_path = "../posts")