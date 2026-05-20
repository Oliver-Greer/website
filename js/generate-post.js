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

        const paragraphs = jsonData[0].body.split('\n\n');

        let paragraphContent = ``;
        let insideBlock = false;
        
        paragraphs.forEach(paragraph => {

            const trimmedParagraph = paragraph.trim();
            if (trimmedParagraph == "") {
                if (insideBlock) {
                    paragraphContent += `${paragraph}\n`;
                }
                return;
            }
            
            // putting $$ in here for mathJax later
            // We check for html tags as well so we can write html in the txt
            // Jank but it works
            if (trimmedParagraph.startsWith('<') || trimmedParagraph.startsWith('</') 
                || trimmedParagraph.startsWith('$$')) {
                insideBlock = !insideBlock;
                paragraphContent += `${paragraph}\n`;
                return;
            }

            if (insideBlock) {
                paragraphContent += `${paragraph}\n`;
                return;
            } else {
                paragraphContent += `<p>${trimmedParagraph}</p>\n`;
            }
        })
        
        const htmlContent = `<h1>
                            ${jsonData[0].title}
                            </h1>
                            <h5>
                                Oliver Greer | ${jsonData[0].date}
                            </h5>
                            <br>
                            ${paragraphContent}
                            `;

        template.innerHTML = htmlContent;

        postSection.appendChild(template.content);
    }

    return true;
}

window.onLoad = generatePost();