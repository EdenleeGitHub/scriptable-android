package dev.scriptable.android;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import org.json.*;
import java.util.Calendar;
import java.util.UUID;

/** Durable notifications and Android alarm equivalents for Scriptable triggers. */
public final class ScriptNotifications extends BroadcastReceiver {
    private static final String STORE="script-notifications-v2";
    private static final String FIRE="dev.scriptable.android.NOTIFICATION_FIRE";
    private static JSONArray load(Context c,String key)throws Exception{return new JSONArray(c.getSharedPreferences(STORE,0).getString(key,"[]"));}
    private static void store(Context c,String key,JSONArray items)throws Exception{if(!c.getSharedPreferences(STORE,0).edit().putString(key,items.toString()).commit())throw new Exception("通知记录无法保存");}
    private static JSONArray without(JSONArray xs,String id)throws Exception{JSONArray out=new JSONArray();for(int i=0;i<xs.length();i++)if(!id.equals(xs.getJSONObject(i).optString("identifier")))out.put(xs.getJSONObject(i));return out;}
    public static synchronized Object call(Context c,String action,JSONObject p)throws Exception{
        switch(action){
            case "notification.resetCurrent":return true;
            case "notification.schedule":return schedule(c,p);
            case "notification.allPending":return load(c,"pending");
            case "notification.allDelivered":return delivered(c);
            case "notification.removePending":case "notification.removeAllPending":case "notification.removeDelivered":case "notification.removeAllDelivered":{
                boolean pending=action.endsWith("Pending");String key=pending?"pending":"delivered";JSONArray all=load(c,key),ids=p.optJSONArray("identifiers");JSONArray keep=new JSONArray();
                for(int i=0;i<all.length();i++){JSONObject n=all.getJSONObject(i);String id=n.getString("identifier");boolean remove=action.contains("All");if(ids!=null)for(int j=0;j<ids.length();j++)remove|=id.equals(ids.optString(j));
                    if(remove){if(pending)alarm(c).cancel(intent(c,id));else ((NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(id,id.hashCode());}else keep.put(n);}
                store(c,key,keep);return true;
            }
            default:throw new Exception("Unknown notification action: "+action);
        }
    }
    private static JSONArray delivered(Context c)throws Exception{java.util.Set<String> active=new java.util.HashSet<>();for(android.service.notification.StatusBarNotification n:((NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE)).getActiveNotifications())if(n.getTag()!=null)active.add(n.getTag());JSONArray rows=load(c,"delivered"),out=new JSONArray();for(int i=0;i<rows.length();i++)if(active.contains(rows.getJSONObject(i).optString("identifier")))out.put(rows.getJSONObject(i));store(c,"delivered",out);return out;}
    private static AlarmManager alarm(Context c){return (AlarmManager)c.getSystemService(Context.ALARM_SERVICE);}
    private static PendingIntent intent(Context c,String id){Intent i=new Intent(c,ScriptNotifications.class).setAction(FIRE).setData(Uri.parse("scriptable-android://notification/"+Uri.encode(id))).putExtra("id",id);return PendingIntent.getBroadcast(c,0,i,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
    private static long next(JSONObject p,long now)throws Exception{
        JSONObject repeat=p.optJSONObject("daily");boolean weekly=false;if(repeat==null){repeat=p.optJSONObject("weekly");weekly=repeat!=null;}
        if(repeat==null)return p.optLong("triggerDate",now);
        int hour=repeat.getInt("hour"),minute=repeat.getInt("minute");if(hour<0||hour>23||minute<0||minute>59)throw new Exception("通知时间无效");
        Calendar date=Calendar.getInstance();date.setTimeInMillis(now);date.set(Calendar.HOUR_OF_DAY,hour);date.set(Calendar.MINUTE,minute);date.set(Calendar.SECOND,0);date.set(Calendar.MILLISECOND,0);
        if(weekly){int weekday=repeat.getInt("weekday");if(weekday<1||weekday>7)throw new Exception("weekday 必须为 1 至 7");int days=(weekday-date.get(Calendar.DAY_OF_WEEK)+7)%7;date.add(Calendar.DATE,days);if(date.getTimeInMillis()<=now)date.add(Calendar.DATE,7);}else if(date.getTimeInMillis()<=now)date.add(Calendar.DATE,1);
        return date.getTimeInMillis();
    }
    public static synchronized JSONObject schedule(Context c,JSONObject input)throws Exception{
        if(Build.VERSION.SDK_INT>=33&&c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)throw new SecurityException("需要通知权限");
        NotificationManager nm=(NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE);if(!nm.areNotificationsEnabled())throw new Exception("安卓系统已关闭通知");
        JSONObject p=new JSONObject(input.toString());String id=p.optString("identifier","");if(id.isEmpty())id=UUID.randomUUID().toString();if(id.length()>200)throw new Exception("通知标识过长");p.put("identifier",id);
        if(p.optString("title").length()>200||p.optString("body").length()>12000)throw new Exception("通知文字过长");
        long when=next(p,System.currentTimeMillis());p.put("nextTriggerDate",when);
        if(when<=System.currentTimeMillis()+500){post(c,p);store(c,"pending",without(load(c,"pending"),id));}
        else{JSONArray xs=without(load(c,"pending"),id);xs.put(p);store(c,"pending",xs);scheduleAlarm(c,p);}
        return p;
    }
    private static void scheduleAlarm(Context c,JSONObject p)throws Exception{AlarmManager a=alarm(c);long time=p.getLong("nextTriggerDate");PendingIntent pi=intent(c,p.getString("identifier"));if(Build.VERSION.SDK_INT<31||a.canScheduleExactAlarms())a.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,time,pi);else a.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,time,pi);}
    public static synchronized void restore(Context c)throws Exception{JSONArray xs=load(c,"pending");for(int i=0;i<xs.length();i++){JSONObject p=xs.getJSONObject(i);if(p.optLong("nextTriggerDate")<System.currentTimeMillis())p.put("nextTriggerDate",next(p,System.currentTimeMillis()));scheduleAlarm(c,p);}store(c,"pending",xs);}
    private static Intent destination(Context c,JSONObject p)throws Exception{
        String url=NativeJson.string(p,"openURL","");if(!url.isEmpty()){Uri u=Uri.parse(url);if(u.getScheme()==null||u.getScheme().matches("(?i)javascript|data|file|content|intent"))throw new Exception("通知链接使用了不支持的协议");return new Intent(Intent.ACTION_VIEW,u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);}
        Intent open=new Intent(c,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("notification",p.toString());String script="";
        if(!NativeJson.string(p,"scriptName","").isEmpty()){JSONArray scripts=new ScriptRepository(c).list();for(int i=0;i<scripts.length();i++)if(NativeJson.string(p,"scriptName","").equals(scripts.getJSONObject(i).optString("name")))script=scripts.getJSONObject(i).optString("id");}
        if(!script.isEmpty())open.setData(Uri.parse("scriptable-android://run?id="+Uri.encode(script)));return open;
    }
    private static void post(Context c,JSONObject p)throws Exception{
        if(Build.VERSION.SDK_INT>=33&&c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)throw new SecurityException("需要通知权限");
        boolean silent=p.has("sound")&&(p.isNull("sound")||p.optString("sound").isEmpty());String sound=p.optString("sound","default");String channelId=silent?"scripts-v2-silent":"scripts-v2-"+sound.replaceAll("[^a-z_]","");NotificationManager nm=(NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel channel=new NotificationChannel(channelId,silent?"静默脚本通知":"脚本通知",NotificationManager.IMPORTANCE_DEFAULT);if(silent)channel.setSound(null,null);else{int cue=c.getResources().getIdentifier("notification_"+sound,"raw",c.getPackageName());if(cue!=0)channel.setSound(Uri.parse("android.resource://"+c.getPackageName()+"/"+cue),new android.media.AudioAttributes.Builder().setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION).setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION).build());}nm.createNotificationChannel(channel);
        String id=p.getString("identifier");Notification.Builder b=new Notification.Builder(c,channelId).setSmallIcon(R.drawable.ic_status).setContentTitle(p.optString("title","Scriptable Android")).setContentText(p.optString("body")).setSubText(p.optString("subtitle")).setStyle(new Notification.BigTextStyle().bigText(p.optString("body"))).setAutoCancel(true).setContentIntent(PendingIntent.getActivity(c,id.hashCode(),destination(c,p),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE));
        if(p.has("badge")&&!p.isNull("badge"))b.setNumber(Math.max(0,p.optInt("badge")));if(!NativeJson.string(p,"threadIdentifier","").isEmpty())b.setGroup(NativeJson.string(p,"threadIdentifier",""));
        JSONArray actions=p.optJSONArray("actions");if(actions!=null)for(int i=0;i<Math.min(3,actions.length());i++){JSONObject action=actions.getJSONObject(i);JSONObject actionPayload=new JSONObject(p.toString()).put("openURL",action.optString("url"));b.addAction(new Notification.Action.Builder(null,action.optString("title"),PendingIntent.getActivity(c,(id+":"+i).hashCode(),destination(c,actionPayload),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE)).build());}
        nm.notify(id,id.hashCode(),b.build());p.put("deliveryDate",System.currentTimeMillis());p.put("nextTriggerDate",repeating(p)?next(p,System.currentTimeMillis()+1000):JSONObject.NULL);JSONArray delivered=without(load(c,"delivered"),id);delivered.put(p);while(delivered.length()>200)delivered.remove(0);store(c,"delivered",delivered);
    }
    private static boolean repeating(JSONObject p){JSONObject r=p.optJSONObject("daily");if(r==null)r=p.optJSONObject("weekly");return r!=null&&r.optBoolean("repeats",false);}
    @Override public void onReceive(Context c,Intent i){PendingResult result=goAsync();new Thread(()->{try{if(Intent.ACTION_BOOT_COMPLETED.equals(i.getAction())||Intent.ACTION_MY_PACKAGE_REPLACED.equals(i.getAction()))restore(c);else if(FIRE.equals(i.getAction()))fire(c,i.getStringExtra("id"));}catch(Exception error){c.getSharedPreferences(STORE,0).edit().putString("lastError",error.toString()).apply();}finally{result.finish();}},"script-notification").start();}
    private static synchronized void fire(Context c,String id)throws Exception{JSONArray xs=load(c,"pending");JSONObject current=null;for(int n=0;n<xs.length();n++)if(id.equals(xs.getJSONObject(n).optString("identifier")))current=xs.getJSONObject(n);if(current==null)return;post(c,current);xs=without(xs,id);if(repeating(current)){current.put("nextTriggerDate",next(current,System.currentTimeMillis()+1000));xs.put(current);scheduleAlarm(c,current);}store(c,"pending",xs);}
}
