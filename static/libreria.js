"use strict";
const _URL =  ""


const requestInterceptor = function(request)  {
	if (!request.headers) {
	  request.headers = new Headers();
	}
    if ("authToken" in localStorage) {
		let authToken = localStorage.getItem("authToken");  
		console.log("Token Sent : ", authToken)
		request.headers.set('authorization', authToken);
	}	
	return request;
}

const responseInterceptor = function(response) {
	if (response.headers) {
		let authToken = response.headers.get("authorization")
		if(authToken){
			console.log("Token Received : ", authToken)
			localStorage.setItem("authToken", authToken) 
		}	
	}	
}

async function inviaRichiesta(method, url="", params={}) {
	method = method.toUpperCase()	
	let options = {
		"method": method,
		"headers":{},
		"mode": "cors",                  // default
		"cache": "no-cache",             // default
		"credentials": "same-origin",    // default
		"redirect": "follow",            // default
		"referrerPolicy": "no-referrer", // default no-referrer-when-downgrade
    }
	
	if(method=="GET") {
		const queryParams = new URLSearchParams();
		for (let key in params) {
			let value = params[key];
			// Notare che i parametri di tipo object vengono serializzati
			if (value && typeof value === "object") 
				queryParams.append(key, JSON.stringify(value));
			else 
				queryParams.append(key, value);
		}
		url += "?" + queryParams.toString()
		options.headers["Content-Type"]="application/x-www-form-urlencoded"
	}
	else {
		if(params instanceof FormData){   
			// In caso di formData occorre OMETTERE il Content-Type !
			// options.headers["Content-Type"]="multipart/form-data;" 
			options["body"]=params     // Accept FormData, File, Blob			
		}
		else{			
			options["body"] = JSON.stringify(params)
			options.headers["Content-Type"]="application/json";  
		}
	}
	
	let request = new Request(_URL + url, options);
    request = requestInterceptor(request);

    try{
		const response = await fetch(request)	
		if (!response.ok) {
			let err = await response.text()
			return {"status":response.status, err}
		} 
		else{
		    let data = await response.json().catch(function(err){
				console.log(err)
				return {"status":422, "err":"Response contains an invalid json"}
		    })
			responseInterceptor(response)
			return {"status":200, data}
		}
    }
    catch{ 
	   return {"status":408, "err":"Connection Refused or Server timeout"}
	}
}