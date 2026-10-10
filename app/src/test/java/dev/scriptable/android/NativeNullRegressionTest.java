package dev.scriptable.android;

import android.app.AlertDialog;
import android.app.Dialog;
import android.app.NotificationManager;
import android.content.Context;
import android.graphics.drawable.ColorDrawable;
import android.graphics.Color;
import android.os.Looper;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.ServiceWorkerWebSettings;
import android.widget.EditText;
import android.widget.Button;
import android.widget.TextView;
import android.view.View;
import android.view.ViewGroup;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.Implementation;
import org.robolectric.annotation.Implements;
import org.robolectric.shadows.ShadowAlertDialog;
import org.robolectric.shadows.ShadowDialog;
import org.robolectric.RuntimeEnvironment;
import java.lang.reflect.Method;
import static org.junit.Assert.*;

/** Uses Android's JSONObject, Color and actual dialog views, not the browser mock. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk=28, shadows=NativeNullRegressionTest.WorkerControllerShadow.class)
public class NativeNullRegressionTest {
    @Implements(ServiceWorkerController.class)
    public static class WorkerControllerShadow {
        @Implementation protected static ServiceWorkerController getInstance() {
            return new ServiceWorkerController() {
                @Override public ServiceWorkerWebSettings getServiceWorkerWebSettings(){return null;}
                @Override public void setServiceWorkerClient(ServiceWorkerClient client){}
            };
        }
    }
    private static EditText findInput(View view) {
        if(view instanceof EditText)return (EditText)view;
        if(view instanceof ViewGroup)for(int i=0;i<((ViewGroup)view).getChildCount();i++){EditText input=findInput(((ViewGroup)view).getChildAt(i));if(input!=null)return input;}
        return null;
    }
    private static TextView findText(View view,String text){
        if(view instanceof TextView&&text.equals(((TextView)view).getText().toString()))return (TextView)view;
        if(view instanceof ViewGroup)for(int i=0;i<((ViewGroup)view).getChildCount();i++){TextView found=findText(((ViewGroup)view).getChildAt(i),text);if(found!=null)return found;}return null;
    }
    private static AlertDialog present(JSONObject field)throws Exception{
        MainActivity activity=Robolectric.buildActivity(MainActivity.class).create().start().resume().visible().get();
        JSONObject payload=new JSONObject().put("title","随手记一笔").put("actions",new JSONArray().put(new JSONObject().put("title","保存"))).put("cancel",JSONObject.NULL).put("textFields",new JSONArray().put(field));
        Method show=MainActivity.class.getDeclaredMethod("showScriptAlert",String.class,JSONObject.class);show.setAccessible(true);show.invoke(activity,"native-regression",payload);Shadows.shadowOf(Looper.getMainLooper()).idle();
        AlertDialog dialog=ShadowAlertDialog.getLatestAlertDialog();assertNotNull(dialog);assertTrue(dialog.isShowing());return dialog;
    }
    @Test public void platformNullReallyDiffersFromTheBrowserMock()throws Exception{
        JSONObject field=new JSONObject("{\"textColor\":null}");assertEquals("null",field.optString("textColor",""));assertTrue(field.isNull("textColor"));
    }
    @Test public void defaultNoteFieldWithNullColorOpensAndAcceptsText()throws Exception{
        AlertDialog dialog=present(new JSONObject("{\"placeholder\":\"今天有什么想法？\",\"value\":\"\",\"secure\":false,\"textColor\":null,\"font\":null}"));
        EditText input=findInput(dialog.getWindow().getDecorView());assertNotNull(input);input.setText("安卓笔记回归验证");assertEquals("安卓笔记回归验证",input.getText().toString());
    }
    @Test public void anExplicitAlphaColorKeepsItsColorAndAlpha()throws Exception{
        AlertDialog dialog=present(new JSONObject().put("value","测试").put("textColor","#12AB4580").put("secure",false));
        EditText input=findInput(dialog.getWindow().getDecorView());assertNotNull(input);assertEquals(Color.argb(128,18,171,69),input.getCurrentTextColor());
    }
    @Test public void omittedColorAndLiteralNullTextUseNormalInputDefaults()throws Exception{
        AlertDialog dialog=present(new JSONObject().put("value","null"));EditText input=findInput(dialog.getWindow().getDecorView());
        assertEquals("null",input.getText().toString());
        assertEquals("null",NativeJson.string(new JSONObject("{\"text\":\"null\"}"),"text","fallback"));
        assertEquals("fallback",NativeJson.string(new JSONObject("{\"text\":null}"),"text","fallback"));
    }
    @Test public void nullCancelDoesNotCreateAButtonLabelledNull()throws Exception{
        AlertDialog dialog=present(new JSONObject().put("value",""));assertNull(findText(dialog.getWindow().getDecorView(),"null"));assertTrue(findText(dialog.getWindow().getDecorView(),"保存") instanceof Button);
    }
    @Test public void defaultNotificationWithNullLinkIsActuallyPosted()throws Exception{
        Context context=RuntimeEnvironment.getApplication();JSONObject payload=new JSONObject("{\"title\":\"原生通知回归\",\"body\":\"默认链接为空\",\"sound\":null,\"openURL\":null,\"scriptName\":null,\"threadIdentifier\":null}");
        JSONObject record=ScriptNotifications.schedule(context,payload);assertTrue(record.getLong("deliveryDate")>0);
        NotificationManager manager=(NotificationManager)context.getSystemService(Context.NOTIFICATION_SERVICE);assertEquals(1,manager.getActiveNotifications().length);
        assertNull(Shadows.shadowOf(manager.getActiveNotifications()[0].getNotification().contentIntent).getSavedIntent().getData());
    }
    @Test public void scheduledNotificationWithNullLinkDeliversWithoutAnInvalidUri()throws Exception{
        Context context=RuntimeEnvironment.getApplication();String id="native-null-scheduled";JSONObject payload=new JSONObject().put("title","定时回归").put("identifier",id).put("openURL",JSONObject.NULL).put("sound",JSONObject.NULL).put("triggerDate",System.currentTimeMillis()+60000);
        ScriptNotifications.schedule(context,payload);Method fire=ScriptNotifications.class.getDeclaredMethod("fire",Context.class,String.class);fire.setAccessible(true);fire.invoke(null,context,id);
        NotificationManager manager=(NotificationManager)context.getSystemService(Context.NOTIFICATION_SERVICE);assertEquals(1,manager.getActiveNotifications().length);assertEquals(0,((JSONArray)ScriptNotifications.call(context,"notification.allPending",new JSONObject())).length());
    }
    @Test public void clearingImageTintKeepsOriginalPixelsUnfiltered()throws Exception{
        assertNull(WidgetRenderer.imagePaint(new JSONObject("{\"tintColor\":null}")).getColorFilter());
        assertNull(WidgetRenderer.imagePaint(new JSONObject()).getColorFilter());
        assertNotNull(WidgetRenderer.imagePaint(new JSONObject().put("tintColor","#007AFF")).getColorFilter());
    }
    @Test public void nullWidgetUrlDoesNotProduceALiteralNullClickTarget()throws Exception{
        JSONObject tree=new JSONObject("{\"type\":\"widget\",\"layout\":\"vertical\",\"url\":null,\"backgroundColor\":null,\"children\":[{\"type\":\"text\",\"text\":\"正文\",\"url\":null}]}");
        WidgetRenderer.Result result=WidgetRenderer.render(tree,200,100,1);assertTrue(result.hits.isEmpty());result.bitmap.recycle();
    }
    @Test public void nullTableColorsPreserveHeaderAndButtonDefaults()throws Exception{
        MainActivity activity=Robolectric.buildActivity(MainActivity.class).create().start().resume().visible().get();java.util.List<Exception> errors=new java.util.ArrayList<>();
        NativePresentation presentation=new NativePresentation(activity,new NativePresentation.Callback(){public void resolve(String id,Object value){}public void reject(String id,Exception error){errors.add(error);}public void event(String id,JSONObject value){}});
        JSONObject row=new JSONObject("{\"id\":\"header\",\"isHeader\":true,\"backgroundColor\":null,\"cells\":[{\"id\":\"button\",\"type\":\"button\",\"title\":\"点击测试\",\"titleColor\":null,\"titleFont\":null}]}" );
        presentation.handle("table-null-regression","table.present",new JSONObject().put("tableId","null-table").put("rows",new JSONArray().put(row)));assertTrue(errors.toString(),errors.isEmpty());
        Dialog dialog=ShadowDialog.getLatestDialog();TextView title=findText(dialog.getWindow().getDecorView(),"点击测试");assertNotNull(title);assertEquals(Color.parseColor("#007AFF"),title.getCurrentTextColor());
        View header=(View)title.getParent().getParent();assertEquals(Color.parseColor("#F0F2F6"),((ColorDrawable)header.getBackground()).getColor());presentation.close();
    }
}
