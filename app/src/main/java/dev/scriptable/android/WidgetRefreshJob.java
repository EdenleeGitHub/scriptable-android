package dev.scriptable.android;

import android.app.job.*;
import android.content.*;
import android.os.*;
import org.json.*;
import java.util.*;

/** Android-managed background refresh, with independent widget scripts and last-good images. */
public final class WidgetRefreshJob extends JobService {
    private static final int PERIODIC=20820,IMMEDIATE=20821;
    private final Queue<JSONObject> queue=new ArrayDeque<>();private HeadlessWidgetRunner runner;private JobParameters active;
    private final Queue<JobParameters> waiting=new ArrayDeque<>();private int generation;
    public static void schedule(Context c){JobScheduler jobs=(JobScheduler)c.getSystemService(Context.JOB_SCHEDULER_SERVICE);if(jobs.getPendingJob(PERIODIC)==null)jobs.schedule(new JobInfo.Builder(PERIODIC,new ComponentName(c,WidgetRefreshJob.class)).setPeriodic(15*60*1000L).setPersisted(true).build());}
    public static void request(Context c,int[] ids){schedule(c);PersistableBundle data=new PersistableBundle();if(ids!=null)data.putIntArray("widgetIds",ids);((JobScheduler)c.getSystemService(Context.JOB_SCHEDULER_SERVICE)).schedule(new JobInfo.Builder(IMMEDIATE,new ComponentName(c,WidgetRefreshJob.class)).setMinimumLatency(1).setExtras(data).build());}
    @Override public boolean onStartJob(JobParameters p){if(active!=null){waiting.add(p);return true;}return begin(p);}
    private boolean begin(JobParameters p){active=p;generation++;queue.clear();try{Set<Integer> wanted=new HashSet<>();int[] ids=p.getExtras().getIntArray("widgetIds");if(ids!=null)for(int id:ids)wanted.add(id);JSONArray xs=ScriptWidgetProvider.instanceConfigs(this);for(int i=0;i<xs.length();i++){JSONObject cfg=xs.getJSONObject(i);boolean due=p.getJobId()!=PERIODIC||cfg.optLong("refreshAfterDate",0)<=System.currentTimeMillis();if(due&&(ids==null||wanted.contains(cfg.getInt("widgetId"))))queue.add(cfg);}if(queue.isEmpty()){active=null;return false;}next();return true;}catch(Exception e){active=null;getSharedPreferences("widget-refresh",0).edit().putString("error",e.toString()).apply();return false;}}
    private void next(){JSONObject cfg=queue.poll();if(cfg==null){runner=null;if(active!=null)jobFinished(active,false);active=null;JobParameters next=waiting.poll();if(next!=null&&!begin(next))jobFinished(next,false);return;}final int expected=generation;runner=new HeadlessWidgetRunner(this,cfg,error->{if(generation!=expected)return;getSharedPreferences("widget-refresh",0).edit().putLong("lastRefresh",System.currentTimeMillis()).putString("error",error==null?"":error).apply();if(active!=null)next();});runner.start();}
    @Override public boolean onStopJob(JobParameters p){if(active==null||active.getJobId()!=p.getJobId()){waiting.removeIf(job->job.getJobId()==p.getJobId());return true;}generation++;active=null;queue.clear();if(runner!=null)runner.stop();runner=null;JobParameters next=waiting.poll();if(next!=null&&!begin(next))jobFinished(next,false);return true;}
}
