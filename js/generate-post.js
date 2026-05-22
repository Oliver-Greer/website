async function generatePost() {

    const queryStr = window.location.search;
    const urlParams = new URLSearchParams(queryStr);
    const postTag = urlParams.get('tag');

    let jsonData = [{"title": "Something Went Wrong", "date": "", "body": ""}];

    try {
        const jsonResponse = await fetch('/posts/posts.json');
        jsonData = await jsonResponse.json();
        // filter for the matching post
        jsonData = jsonData.filter(post => post.tag.includes(postTag));
    } catch (error) {
        console.log(error)
    }

    const postSection = document.getElementById('post');
    
    const template = document.createElement('template');

    if (jsonData.length == 0) {
        const htmlContent = `<p>
                                Nothing here yet, come back later.
                            </p>`;

        template.innerHTML = htmlContent;
        postSection.appendChild(template.content);
    } else {

        const lines = jsonData[0].body.split('\n');

        let paragraph = [];
        let content = ``;
        let insideBlock = false;
        
        lines.forEach(line => {

            const trimmedLine = line.trim();

            // if there is a < or </ or $$:
                // if not in block: flush current paragraph to <p> tag, reset paragraph to []
                // toggle block
                // add line to html

            // if in block:
                // add line to html
            // else:
                // if line is empty, start new paragraph
                // else, push line to paragraph array

            // putting $$ in here for mathJax later
            // We check for html tags as well so we can write html in the txt file
            // Jank but it works
            if (trimmedLine.startsWith('<') || trimmedLine.startsWith('</') || trimmedLine.startsWith('$$')) {
                if (!insideBlock) {
                    let newParagraph = paragraph.join('\n')
                    content += `<p>${newParagraph}</p>\n`;
                }
                paragraph = []
                insideBlock = !insideBlock;
                content += `${line}\n`;
                return;
            }
            
            if (insideBlock) {
                content += `${line}\n`;
                return;
            } else {
                if (trimmedLine == "") {
                    let newParagraph = paragraph.join('\n')
                    content += `<p>${newParagraph}</p>\n`;
                    paragraph = []
                } else {
                    paragraph.push(`${line}\n`);
                }
            }
        })

        // if there is still some left over flush
        if (paragraph.length > 0) {
            let newParagraph = paragraph.join('\n')
            content += `<p>${newParagraph}</p>\n`;
        }
        
        const htmlContent = `<h1>
                            ${jsonData[0].title}
                            </h1>
                            <small>
                                Oliver Greer | ${jsonData[0].date}
                            </small>
                            <br>
                            <br>
                            ${content}
                            `;

        template.innerHTML = htmlContent;

        postSection.appendChild(template.content);
    }

    return true;
}

window.onLoad = generatePost();