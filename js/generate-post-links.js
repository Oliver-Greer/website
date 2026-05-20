async function generateLinks() {

    let jsonData = [{"title": "Something Went Wrong","date": ""}];

    try {
        const jsonResponse = await fetch('/posts/posts.json');
        jsonData = await jsonResponse.json();
    } catch (error) {
        console.log(error)
    }

    const postSection = document.getElementById('post-links');

    if (jsonData.length == 0) {
        const template = document.createElement('template');
        const htmlContent = `<p> 
                                Nothing here yet, come back later.
                            </p>`
        template.innerHTML = htmlContent;
        postSection.appendChild(template.content);
    } else {
    
        const ul = document.createElement('ul');
        postSection.appendChild(ul);

        jsonData.forEach(post => {
            const template = document.createElement('template');
            const urlParams = new URLSearchParams();
            urlParams.append('tag', `${post.tag}`);
            const htmlContent = `<li> 
                                    <a href="/post.html?${urlParams.toString()}">
                                        <b> ${post.title} </b>
                                    </a>
                                    <br>
                                    <small style="margin-left: 1rem;">  ${post.date} </small>
                                </li>`
            template.innerHTML = htmlContent;
            ul.appendChild(template.content);
        });
    }

    return true;
}

window.onLoad = generateLinks();