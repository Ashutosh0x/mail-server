# kotlinx.serialization keeps its generated serializers through reflection on
# the companion; R8 cannot see that and strips them without these rules.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class kotlinx.serialization.json.** { kotlinx.serialization.KSerializer serializer(...); }
-keep,includedescriptorclasses class com.mailserver.android.**$$serializer { *; }
-keepclassmembers class com.mailserver.android.** { *** Companion; }
-keepclasseswithmembers class com.mailserver.android.** { kotlinx.serialization.KSerializer serializer(...); }

# Retrofit interfaces are referenced only reflectively.
-keep,allowobfuscation interface com.mailserver.android.data.remote.*Api
-keepattributes Signature, Exceptions
