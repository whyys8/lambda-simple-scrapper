const https = require('https');
const crypto = require('crypto');
const he = require('he'); 

const AWS = require("aws-sdk");
const documentClient = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS({apiVersion: '2012-11-05'});

const blogs = ['danielfooddiary.com/','eatbook.sg/','sethlui.com/'];

function get_page(url) { 
    return new Promise((resolve) => {
        let data = ''
        https.get(url, res => {
            res.on('data', chunk => { data += chunk }) 
            res.on('end', () => {
               resolve(data);
            })
        }) 
    })
}

function get_title_postal(page_html) {
    return new Promise(async (resolve) => {
        let page_title = page_html.substring(page_html.toLowerCase().indexOf('<title>') +7, page_html.toLowerCase().indexOf('</title>'));
        
        let page_array = [];
        //let pattern_htmltags = />((.|\n)*)singapore\s(\d{6})((.|\n)*)</g
        let pattern_addr = /singapore (\d{6})/g
        while (match = pattern_addr.exec(page_html.toLowerCase())) {
            //page_array.push(page_html.substring(match.index, pattern_addr.lastIndex))
            page_array.push(page_html.substring(pattern_addr.lastIndex -6, pattern_addr.lastIndex))
        }
        
        resolve([page_title,page_array]);
    })
}

function get_all_urls(page_html) {
    return new Promise(async (resolve) => {  
        let url_array = [];
        let url_scanned = '';
        let pattern_addr = /(http|https):\/\/([\w_-]+(?:(?:\.[\w_-]+)+))([\w.,@?^=%&:\/~+#-]*[\w@?^=%&\/~+#-])\//g
        while (match = pattern_addr.exec(page_html.toLowerCase())) {
            url_scanned = page_html.substring(match.index, pattern_addr.lastIndex);
            
            if (!(url_array.includes(url_scanned))) {
                for(var x=0; x<blogs.length; x++) {
                    if (url_scanned.indexOf(blogs[x]) > 0 && url_scanned.indexOf(blogs[x]) < 20 
                            && url_scanned.substring(0,8) == 'https://'
                            && url_scanned.indexOf('/wp-') <= 0 && url_scanned.indexOf('tag/') <= 0 && url_scanned.indexOf('feed/') <= 0 && url_scanned.indexOf('category/') <= 0 && url_scanned.indexOf('page/') <= 0 
                    ) {
                        url_array.push(url_scanned.toLowerCase());
                    }
                }
            } 
        }
        
        resolve(url_array);
    })
}

function saveBlog(postal, title, url){
    
    var hash = crypto.createHash('sha256', 'whyys').update(postal+url).digest('hex');
    var date = new Date();
    
    let shopParam = {
        "TableName": 'eatluh-blogs',
        "Item": {
            "ids": hash, 
            "postal": +postal,
            "title": `${he.decode(title)}`, 
            "url": `${url}`,
            "date": `${date}`
        }
    }
    return documentClient.put(shopParam, (err)=>{
        if(err){
            console.log('Storing to DB FAIL', err)
        }
        else {
            //console.log('Stored DB')
        }
    }).promise()
}


function saveQueue(url){
    var params = { 
      MessageAttributes: {},
      MessageBody: url, 
      QueueUrl: "https://sqs.ap-southeast-1.amazonaws.com/141297251783/web-scrapper"
    };
    
    return sqs.sendMessage(params, function(err, data) {
      if (err) {
        console.log("Error", err);
      } else {
        console.log("Success", data.MessageId);
      }
    }).promise();
}

exports.handler = async (event) => { 
    
    // List of default domains (fullpath)
    let blogsDefault = [];
    for(var k=0; k<blogs.length; k++){
        blogsDefault.push('https://'+blogs[k])
    }
    
    
    // If URL is provided, execute function
    if (event && event.Records && event.Records[0].body) {
        let url = event.Records[0].body;
        
        if (url.substring(0,8)=='https://') {
            
            var urlFound = 0;
            
            if (blogsDefault.indexOf(url) >= 0) {
                // Index page - must read again
                urlFound = 0;
            }
            else {
                // Check if this url was loaded before 
                var scanPar = {
                  TableName: 'eatluh-blogs',
                  IndexName: 'url-index',
                  KeyConditionExpression: '#url = :ukey',
                  ExpressionAttributeNames: { "#url": "url" },
                  ExpressionAttributeValues: {
                    ':ukey': `${url}`
                  }
                }; 
                await documentClient.query(scanPar, function(err, data) {
                    if (err) {
                        console.log('err',err);
                    }
                    else {
                        if (data.Items && data.Items.length>0){
                            urlFound = data.Items.length;
                        } 
                    } 
                }).promise() 
            }
            
            if (urlFound == 0) {
                
                console.log('Getting '+url)
                
                // Read the webpage content
                let page_html = await get_page(url);
                
                
                // Extract page title & postal codes, save to DDB
                let contents = await get_title_postal(page_html); 
                let scannedEntries = 0;
                
                for(var ii=0; ii<contents[1].length; ii++){
                    // Store this postal
                    await saveBlog(contents[1][ii], contents[0], url);
                    console.log(ii + 'Adding '+contents[1][ii] +' '+ url)
                    scannedEntries++
                }
                
                if (scannedEntries == 0){
                    // If no valid postal found from this URL, save as 000000
                    await saveBlog('000000', contents[0], url);
                }
                
                
                // Extract more URLs and put into SQS
                let extract_urls = await get_all_urls(page_html); 
                for(var j=0; j<extract_urls.length; j++){ 
                    var scanPar = {
                      TableName: 'eatluh-blogs',
                      IndexName: 'url-index',
                      KeyConditionExpression: '#url = :ukey',
                      ExpressionAttributeNames: { "#url": "url" },
                      ExpressionAttributeValues: {
                        ':ukey': `${extract_urls[j]}`
                      }
                    };
                    await documentClient.query(scanPar, async function(err, data) {
                        if (err) {
                            console.log('err',err);
                        }
                        else { 
                            if (data.Items && data.Items.length>0){
                                extract_urls[j] = '';
                            }
                        } 
                    }).promise()
                }
                for(var j=0; j<extract_urls.length; j++){
                    if (extract_urls[j] != '') {
                        await saveQueue(extract_urls[j]);
                        console.log('Queue: ' + extract_urls[j])
                    }
                } 
                
                
                const response = {
                    statusCode: 200,
                    body: 'Created ' + scannedEntries + ' entries for ' + url
                };
                return response;
                
            }
        }
    }
    else {
        // Assume is from Rules trigger
        for(var k=0; k<blogsDefault.length; k++){
            await saveQueue(blogsDefault[k]);
            console.log('Queue: '+blogsDefault[k]);
        }
        
        
        const response = {
            statusCode: 200,
            body: 'Queued blogs'
        };
        return response;
    }
    
    // Log the error
    console.log(event);
    const response = {
        statusCode: 200,
        body: 'Message is not processed'
    };
    return response;
    
};
