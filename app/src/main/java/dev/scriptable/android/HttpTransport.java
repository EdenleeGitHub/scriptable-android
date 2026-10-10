package dev.scriptable.android;

import android.util.Base64;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.*;
import java.util.*;
import java.util.function.BooleanSupplier;
import java.util.zip.GZIPInputStream;
import javax.net.ssl.*;
import java.security.cert.X509Certificate;

/** HTTP transport, multipart uploads, cookies, manual redirects and opt-in TLS override. */
final class HttpTransport {
    private static final java.net.CookieManager COOKIES=new java.net.CookieManager(null,CookiePolicy.ACCEPT_ORIGINAL_SERVER);
    static JSONObject request(String id,JSONObject p,Map<HttpURLConnection,String> active,BooleanSupplier alive)throws Exception{
        URL url=new URL(p.getString("url"));String protocol=url.getProtocol();if(!(protocol.equals("http")||protocol.equals("https"))||url.getHost().isEmpty()||url.getUserInfo()!=null)throw new Exception("Request URL must use HTTP or HTTPS without embedded credentials");
        if(!alive.getAsBoolean())throw new Exception("Script execution was stopped");
        String method=p.optString("method","GET").toUpperCase(Locale.ROOT);if(!method.matches("GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS"))throw new Exception("Invalid HTTP method");
        HttpURLConnection c=(HttpURLConnection)url.openConnection();active.put(c,id);
        try{
            c.setInstanceFollowRedirects(false);int timeout=(int)Math.min(300000,Math.max(1000,p.optDouble("timeoutInterval",60)*1000));c.setConnectTimeout(timeout);c.setReadTimeout(timeout);c.setRequestMethod(method);
            if(c instanceof HttpsURLConnection&&p.optBoolean("allowInsecureRequest")){
                SSLContext tls=SSLContext.getInstance("TLS");tls.init(null,new TrustManager[]{new X509TrustManager(){public X509Certificate[] getAcceptedIssuers(){return new X509Certificate[0];}public void checkClientTrusted(X509Certificate[] chain,String auth){}public void checkServerTrusted(X509Certificate[] chain,String auth){}}},new java.security.SecureRandom());
                ((HttpsURLConnection)c).setSSLSocketFactory(tls.getSocketFactory());((HttpsURLConnection)c).setHostnameVerifier((host,session)->true);
            }
            c.setRequestProperty("User-Agent","ScriptableAndroid/0.2.0");c.setRequestProperty("Accept-Encoding","gzip");
            for(Map.Entry<String,List<String>> e:COOKIES.get(url.toURI(),Collections.emptyMap()).entrySet())c.setRequestProperty(e.getKey(),android.text.TextUtils.join("; ",e.getValue()));
            JSONObject headers=p.optJSONObject("headers");if(headers!=null)for(Iterator<String> it=headers.keys();it.hasNext();){String key=it.next(),value=headers.get(key).toString();if(!key.matches("[A-Za-z0-9!#$%&'*+.^_`|~-]{1,128}")||value.contains("\r")||value.contains("\n"))throw new Exception("Invalid HTTP header");c.setRequestProperty(key,value);}
            byte[] body=null;JSONArray multipart=p.optJSONArray("multipart");
            if(multipart!=null&&multipart.length()>0){String boundary="ScriptableAndroid"+UUID.randomUUID().toString().replace("-","");ByteArrayOutputStream out=new ByteArrayOutputStream();for(int i=0;i<multipart.length();i++){JSONObject part=multipart.getJSONObject(i);String name=part.getString("name");if(name.contains("\r")||name.contains("\n"))throw new Exception("Invalid multipart field");write(out,"--"+boundary+"\r\nContent-Disposition: form-data; name=\""+name.replace("\"","%22")+"\"");if(part.has("base64")){String filename=part.optString("filename","file").replace("\r","").replace("\n","").replace("\"","%22");write(out,"; filename=\""+filename+"\"\r\nContent-Type: "+part.optString("mimeType","application/octet-stream").replaceAll("[\\r\\n]","")+"\r\n\r\n");out.write(Base64.decode(part.getString("base64"),Base64.DEFAULT));}else{write(out,"\r\n\r\n"+part.optString("value"));}write(out,"\r\n");if(out.size()>16*1024*1024)throw new Exception("Multipart body exceeds 16MB");}write(out,"--"+boundary+"--\r\n");body=out.toByteArray();c.setRequestProperty("Content-Type","multipart/form-data; boundary="+boundary);}
            else if(p.has("body")&&!p.isNull("body")){Object value=p.get("body");body=value instanceof JSONObject?Base64.decode(((JSONObject)value).getString("base64"),Base64.DEFAULT):value.toString().getBytes(StandardCharsets.UTF_8);}
            if(body!=null&&!method.equals("GET")&&!method.equals("HEAD")){c.setDoOutput(true);c.setFixedLengthStreamingMode(body.length);try(OutputStream out=c.getOutputStream()){out.write(body);}}
            int status=c.getResponseCode();if(!alive.getAsBoolean())throw new Exception("Script execution was stopped");
            JSONObject hs=new JSONObject();for(Map.Entry<String,List<String>> e:c.getHeaderFields().entrySet())if(e.getKey()!=null)hs.put(e.getKey(),android.text.TextUtils.join(", ",e.getValue()));
            COOKIES.put(url.toURI(),c.getHeaderFields());JSONArray cookies=new JSONArray();for(HttpCookie cookie:COOKIES.getCookieStore().get(url.toURI()))cookies.put(new JSONObject().put("name",cookie.getName()).put("value",cookie.getValue()).put("domain",cookie.getDomain()).put("path",cookie.getPath()).put("httpOnly",cookie.isHttpOnly()).put("sessionOnly",cookie.getMaxAge()<0));
            String location=c.getHeaderField("Location");if(status>=300&&status<400&&location!=null)return new JSONObject().put("statusCode",status).put("headers",hs).put("url",url.toString()).put("redirectURL",new URL(url,location).toString()).put("body","").put("cookies",cookies);
            String type=c.getContentType();if(type==null)type="application/octet-stream";Charset charset=StandardCharsets.UTF_8;for(String part:type.split(";"))if(part.trim().toLowerCase(Locale.ROOT).startsWith("charset=")){try{charset=Charset.forName(part.trim().substring(8).replace("\"",""));}catch(Exception ignored){}}
            byte[] bytes;InputStream stream=status>=400?c.getErrorStream():c.getInputStream();if(stream==null)bytes=new byte[0];else{if("gzip".equalsIgnoreCase(c.getContentEncoding()))stream=new GZIPInputStream(stream);try(InputStream input=stream){bytes=ScriptRepository.readStream(input,16*1024*1024);}}
            return new JSONObject().put("statusCode",status).put("headers",hs).put("url",url.toString()).put("mimeType",type.split(";",2)[0]).put("textEncodingName",charset.name()).put("cookies",cookies).put("body","base64".equals(p.optString("encoding"))?Base64.encodeToString(bytes,Base64.NO_WRAP):new String(bytes,charset));
        }finally{active.remove(c);c.disconnect();}
    }
    private static void write(OutputStream out,String text)throws IOException{out.write(text.getBytes(StandardCharsets.UTF_8));}
}
