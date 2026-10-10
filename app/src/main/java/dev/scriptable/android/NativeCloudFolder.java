package dev.scriptable.android;

import android.app.Activity;
import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** User-selected Android document-provider folder: a cloud/SAF alternative to iCloud. */
final class NativeCloudFolder {
    static final int REQUEST=910;
    interface Callback{void resolve(String id,Object value);void reject(String id,Exception error);}
    private final Activity activity;private final Callback callback;private String choosing,name;
    NativeCloudFolder(Activity a,Callback cb){activity=a;callback=cb;}
    static JSONObject folders(Context c)throws Exception{return new JSONObject(c.getSharedPreferences("cloud-folders",0).getString("folders","{}"));}
    static JSONObject status(Context c)throws Exception{return new JSONObject().put("configured",folders(c).has("Cloud")).put("folders",folders(c)).put("lastError",c.getSharedPreferences("cloud-folders",0).getString("lastError",""));}
    void choose(String id,JSONObject payload)throws Exception{
        if(choosing!=null)throw new Exception("文件夹选择器正在打开");name=payload.optString("bookmarkName","Cloud");if(name.isEmpty()||name.length()>80||name.contains("/")||name.contains("\\")||name.equals(".")||name.equals(".."))throw new Exception("书签名称无效");choosing=id;
        try{activity.startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION|Intent.FLAG_GRANT_PREFIX_URI_PERMISSION),REQUEST);}catch(Exception e){choosing=null;throw e;}
    }
    boolean result(int code,int result,Intent data){if(code!=REQUEST)return false;String id=choosing,alias=name;choosing=null;name=null;if(id==null)return true;if(result!=Activity.RESULT_OK||data==null||data.getData()==null){callback.resolve(id,null);return true;}
        Uri uri=data.getData();try{int flags=data.getFlags()&(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);activity.getContentResolver().takePersistableUriPermission(uri,(flags&Intent.FLAG_GRANT_WRITE_URI_PERMISSION)!=0?Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION:Intent.FLAG_GRANT_READ_URI_PERMISSION);}catch(Exception e){callback.reject(id,e);return true;}
        new Thread(()->{JSONObject previous=null;try{previous=folders(activity);android.content.SharedPreferences prefs=activity.getSharedPreferences("cloud-folders",0);if(new JSONArray(prefs.getString("pending","[]")).length()>0&&previous.has(alias)&&!uri.toString().equals(previous.optString(alias)))throw new Exception("原文件夹仍有待上传变更，请先同步或导出备份");JSONObject map=new JSONObject(previous.toString());map.put(alias,uri.toString());if(!activity.getSharedPreferences("cloud-folders",0).edit().putString("folders",map.toString()).commit())throw new Exception("文件夹关联无法保存");pull(activity,alias);callback.resolve(id,new JSONObject().put("cloud",status(activity)).put("files",new ScriptRepository(activity).fileSnapshot()));}catch(Exception e){if(previous!=null)activity.getSharedPreferences("cloud-folders",0).edit().putString("folders",previous.toString()).commit();callback.reject(id,e);}},"script-cloud-folder").start();return true;
    }
    void cancel(Set<String> ids){if(choosing!=null&&ids.contains(choosing)){choosing=null;name=null;}}
    private static String rootPath(String name){return "Cloud".equals(name)?"/cloud":"/bookmarks/"+name;}
    private static File local(Context c,String path)throws Exception{File root=new File(c.getFilesDir(),"script-files").getCanonicalFile();File f=new File(root,path.substring(1)).getCanonicalFile();if(!f.getPath().startsWith(root.getPath()+File.separator))throw new Exception("非法云文件路径");return f;}
    static synchronized JSONObject sync(Context c,JSONObject p)throws Exception{replay(c);JSONObject map=folders(c);for(Iterator<String> it=map.keys();it.hasNext();)pull(c,it.next());return new JSONObject().put("cloud",status(c)).put("files",new ScriptRepository(c).fileSnapshot());}
    private static void pull(Context c,String alias)throws Exception{
        String value=folders(c).optString(alias,"");if(value.isEmpty())throw new Exception("请先关联安卓文件或云服务文件夹");Uri tree=Uri.parse(value);
        File stage=java.nio.file.Files.createTempDirectory(c.getCacheDir().toPath(),"cloud-stage-").toFile();
        try{int[] budget={ScriptRepository.MAX_BYTES,0};copyFromProvider(c,tree,DocumentsContract.getTreeDocumentId(tree),stage,budget,0);new ScriptRepository(c).replaceFolderFromStaging(stage,rootPath(alias));}finally{deleteCache(stage);}
    }
    private static void deleteCache(File file){if(!file.exists())return;File[] children=file.listFiles();if(children!=null)for(File child:children)deleteCache(child);file.delete();}

    private static void copyFromProvider(Context c,Uri tree,String parent,File target,int[] budget,int depth)throws Exception{
        if(depth>16)throw new Exception("云文件夹层级过深");Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(tree,parent);
        try(Cursor cursor=c.getContentResolver().query(children,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE},null,null,null)){
            if(cursor==null)throw new Exception("安卓文件提供器无法读取目录");while(cursor.moveToNext()){if(++budget[1]>2048)throw new Exception("请关联最多 2048 个条目的脚本文件夹");String id=cursor.getString(0),name=cursor.getString(1),mime=cursor.getString(2);validateName(name);File dest=new File(target,name);if(DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)){if(!dest.isDirectory()&&!dest.mkdirs())throw new Exception("缓存文件夹无法创建");copyFromProvider(c,tree,id,dest,budget,depth+1);}else{try(InputStream input=c.getContentResolver().openInputStream(DocumentsContract.buildDocumentUriUsingTree(tree,id))){if(input==null)throw new Exception("云文件不可读取");byte[] bytes=ScriptRepository.readStream(input,budget[0]);budget[0]-=bytes.length;ScriptRepository.atomicWrite(dest,bytes);}}}
        }
    }
    private static void validateName(String name)throws Exception{if(name==null||name.isEmpty()||name.contains("/")||name.contains("\\")||name.equals(".")||name.equals(".."))throw new Exception("文件提供器返回了不安全的文件名");}
    private static class Address{String alias,relative;Uri tree;}
    private static Address address(Context c,String path)throws Exception{
        Address a=new Address();if(path.equals("/cloud")||path.startsWith("/cloud/")){a.alias="Cloud";a.relative=path.length()>6?path.substring(7):"";}else if(path.startsWith("/bookmarks/")){String[] parts=path.substring(11).split("/",2);a.alias=parts[0];a.relative=parts.length>1?parts[1]:"";}else return null;
        String value=folders(c).optString(a.alias,"");if(value.isEmpty())throw new Exception("此安卓文件夹尚未关联");a.tree=Uri.parse(value);for(String part:a.relative.split("/"))if(!part.isEmpty())validateName(part);return a;
    }
    private static Uri find(Context c,Address a,boolean createParent,boolean directory)throws Exception{
        String id=DocumentsContract.getTreeDocumentId(a.tree);String[] segments=a.relative.split("/");for(int i=0;i<segments.length;i++){String segment=segments[i];if(segment.isEmpty())continue;String found=null;Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(a.tree,id);
            try(Cursor cursor=c.getContentResolver().query(children,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)){if(cursor==null)throw new Exception("目录无法读取");while(cursor.moveToNext())if(segment.equals(cursor.getString(1))){found=cursor.getString(0);break;}}
            if(found==null){if(!createParent)return null;boolean folder=i<segments.length-1||directory;Uri made=DocumentsContract.createDocument(c.getContentResolver(),DocumentsContract.buildDocumentUriUsingTree(a.tree,id),folder?DocumentsContract.Document.MIME_TYPE_DIR:mime(segment),segment);if(made==null)throw new Exception("文件提供器无法创建条目");found=DocumentsContract.getDocumentId(made);}id=found;
        }return DocumentsContract.buildDocumentUriUsingTree(a.tree,id);
    }
    private static String mime(String name){String ext=name.contains(".")?name.substring(name.lastIndexOf('.')+1).toLowerCase(Locale.ROOT):"";String type=android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);return type==null?"application/octet-stream":type;}
    private static void applyMutation(Context c,JSONObject p)throws Exception{
        String path=p.getString("path"),destination=p.optString("destination","");Address src=address(c,path),dst=destination.isEmpty()?null:address(c,destination);if(src==null&&dst==null)return;
        String op=p.getString("op");if(op.equals("remove")){Uri uri=find(c,src,false,false);if(uri!=null&&!DocumentsContract.deleteDocument(c.getContentResolver(),uri))throw new Exception("远端文件未删除");return;}
        if(op.equals("move")||op.equals("copy")){if(dst!=null)pushPayload(c,dst,p,local(c,destination));if(op.equals("move")&&src!=null){Uri uri=find(c,src,false,false);if(uri!=null&&!DocumentsContract.deleteDocument(c.getContentResolver(),uri))throw new Exception("远端旧文件未删除");}}else if(src!=null)pushPayload(c,src,p,local(c,path));
    }
    static synchronized Object fileOperation(Context c,ScriptRepository repo,JSONObject payload)throws Exception{
        Object value=repo.fileOperation(payload);mutation(c,payload);return value;
    }
    static synchronized void mutation(Context c,JSONObject input)throws Exception{
        JSONObject p=new JSONObject(input.toString());Address src=address(c,p.getString("path")),dst=p.has("destination")?address(c,p.getString("destination")):null;if(src==null&&dst==null)return;
        if(!"remove".equals(p.getString("op"))){String path=p.has("destination")?p.getString("destination"):p.getString("path");JSONArray snapshot=new JSONArray();capture(local(c,path),"",snapshot);p.put("_cloudSnapshot",snapshot);}
        android.content.SharedPreferences prefs=c.getSharedPreferences("cloud-folders",0);JSONArray queue=new JSONArray(prefs.getString("pending","[]"));queue.put(p);
        if(queue.toString().length()>16*1024*1024){prefs.edit().putBoolean("blocked",true).putString("lastError","待同步记录超过限制；本地副本保留，请先导出备份").commit();throw new Exception("待同步记录过大；本地副本保留，请导出备份");}
        if(!prefs.edit().putString("pending",queue.toString()).commit())throw new Exception("本地副本已保存，但云同步记录无法保存");replay(c);
    }
    private static void capture(File f,String relative,JSONArray out)throws Exception{
        if(f.isDirectory()){out.put(new JSONObject().put("path",relative).put("directory",true));File[] children=f.listFiles();if(children!=null)for(File child:children)capture(child,relative.isEmpty()?child.getName():relative+"/"+child.getName(),out);}
        else try(InputStream in=new FileInputStream(f)){out.put(new JSONObject().put("path",relative).put("base64",android.util.Base64.encodeToString(ScriptRepository.readStream(in,ScriptRepository.MAX_BYTES),android.util.Base64.NO_WRAP)));}
    }
    private static void replay(Context c)throws Exception{
        android.content.SharedPreferences prefs=c.getSharedPreferences("cloud-folders",0);if(prefs.getBoolean("blocked",false))throw new Exception("本地云副本有未同步变更，请先导出备份再重新关联");JSONArray queue=new JSONArray(prefs.getString("pending","[]"));
        try{while(queue.length()>0){applyMutation(c,queue.getJSONObject(0));queue.remove(0);if(!prefs.edit().putString("pending",queue.toString()).commit())throw new Exception("云同步记录无法更新");}prefs.edit().putString("lastError","").apply();}catch(Exception error){prefs.edit().putString("lastError",error.getMessage()).apply();throw new Exception("云服务未同步；本地副本及待上传记录已保留："+error.getMessage(),error);}
    }
    private static void pushPayload(Context c,Address address,JSONObject p,File fallback)throws Exception{
        JSONArray snapshot=p.optJSONArray("_cloudSnapshot");if(snapshot==null){push(c,address,fallback);return;}
        for(int i=0;i<snapshot.length();i++){JSONObject entry=snapshot.getJSONObject(i);Address a=new Address();a.tree=address.tree;a.alias=address.alias;a.relative=address.relative+(entry.getString("path").isEmpty()?"":(address.relative.isEmpty()?"":"/")+entry.getString("path"));Uri uri=find(c,a,true,entry.optBoolean("directory"));
            if(!entry.optBoolean("directory"))try(OutputStream out=c.getContentResolver().openOutputStream(uri,"wt")){if(out==null)throw new Exception("云文件夹没有写入权限");out.write(android.util.Base64.decode(entry.getString("base64"),android.util.Base64.DEFAULT));}
        }
    }
    private static void push(Context c,Address a,File file)throws Exception{
        Uri uri=find(c,a,true,file.isDirectory());if(file.isDirectory()){File[] children=file.listFiles();if(children!=null)for(File child:children){Address next=new Address();next.alias=a.alias;next.tree=a.tree;next.relative=a.relative+(a.relative.isEmpty()?"":"/")+child.getName();push(c,next,child);}}else try(InputStream input=new FileInputStream(file);OutputStream output=c.getContentResolver().openOutputStream(uri,"wt")){if(output==null)throw new Exception("云文件夹没有写入权限");byte[] buf=new byte[8192];int n;while((n=input.read(buf))!=-1)output.write(buf,0,n);}
    }
}
